import { loadSource } from './loader'
import { expandReferences, resolveObject } from './references'
import { configSchema, object, type ApiQuery, type ApiSummary, type JsonObject, type JsonValue, type LoadedSource, type McpConfig } from './types'

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
const strings = (value: JsonValue | undefined): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string') : []
const optionalString = (value: JsonValue | undefined) => typeof value === 'string' ? value : undefined

interface Entry {
  summary: ApiSummary
  loaded: LoadedSource
  pathItem: JsonObject
  operation: JsonObject
}

export class OpenApiRepository {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly sources: LoadedSource[]) {
    for (const loaded of sources) {
      const { source, document } = loaded
      for (const [apiPath, rawPathItem] of Object.entries(object(document.paths))) {
        const pathItem = resolveObject(document, rawPathItem)
        for (const method of METHODS) {
          if (!pathItem[method] || typeof pathItem[method] !== 'object') continue
          const operation = object(pathItem[method])
          const tags = strings(operation.tags)
          if (source.tags?.length && !source.tags.some(tag => tags.includes(tag))) continue
          const id = `${source.name}::${method.toUpperCase()} ${apiPath}`
          const summary: ApiSummary = {
            id, source: source.name, method: method.toUpperCase(), path: apiPath,
            operationId: optionalString(operation.operationId), summary: optionalString(operation.summary),
            tags, deprecated: operation.deprecated === true,
          }
          this.entries.set(id, { summary, loaded, pathItem, operation })
        }
      }
    }
  }

  static async load(config: McpConfig, baseDir: string): Promise<OpenApiRepository> {
    const checked = configSchema.parse(config)
    // Sequential loading keeps request concurrency bounded for internal gateways.
    const loaded: LoadedSource[] = []
    for (const source of checked.sources) loaded.push(await loadSource(source, baseDir))
    return new OpenApiRepository(loaded)
  }

  list(query: ApiQuery = {}) {
    if (query.source && !this.sources.some(({ source }) => source.name === query.source)) {
      throw new Error(`Unknown source: ${query.source}`)
    }
    const terms = query.query?.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean) ?? []
    const matches = [...this.entries.values()].filter(({ summary, operation }) => {
      if (query.source && summary.source !== query.source) return false
      if (query.tag && !summary.tags.includes(query.tag)) return false
      if (query.method && summary.method !== query.method.toUpperCase()) return false
      const text = [summary.path, summary.summary, summary.operationId, ...summary.tags, operation.description].join(' ').toLocaleLowerCase()
      return terms.every(term => text.includes(term))
    })
    const offset = query.offset ?? 0
    const limit = query.limit ?? 20
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('offset must be >= 0 and limit must be between 1 and 100')
    }
    return {
      sources: this.sources.map(({ source, document }) => ({
        name: source.name, info: document.info,
        apiCount: [...this.entries.values()].filter(entry => entry.summary.source === source.name).length,
      })),
      total: matches.length, offset, limit,
      nextOffset: offset + limit < matches.length ? offset + limit : null,
      apis: matches.slice(offset, offset + limit).map(entry => entry.summary),
    }
  }

  detail(id: string, maxDepth = 8) {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('Unknown API id. Use list_apis or search_apis to find an exact id.')
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 20) throw new Error('maxDepth must be between 1 and 20')
    const { summary, loaded: { document }, pathItem, operation } = entry
    // Operation parameters override path parameters with the same name and location.
    const parameters = new Map<string, JsonObject>()
    for (const value of [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
      ...(Array.isArray(operation.parameters) ? operation.parameters : [])]) {
      const parameter = resolveObject(document, value)
      parameters.set(JSON.stringify([parameter.in, parameter.name, parameter.$ref]), parameter)
    }
    const isV2 = document.swagger === '2.0'
    const requestBody = operation.requestBody ?? (isV2 ? {
      consumes: operation.consumes ?? document.consumes ?? [],
      bodyParameters: [...parameters.values()].filter(p => p.in === 'body'),
      formDataParameters: [...parameters.values()].filter(p => p.in === 'formData'),
    } : null)
    const detail: JsonObject = {
      ...summary, tags: summary.tags,
      operationId: summary.operationId ?? null, summary: summary.summary ?? null,
      description: operation.description ?? null,
      specificationVersion: document.openapi ?? document.swagger ?? null,
      info: document.info ?? {},
      servers: operation.servers ?? pathItem.servers ?? document.servers ?? [],
      ...(isV2 ? { host: document.host ?? null, basePath: document.basePath ?? '/', schemes: document.schemes ?? [],
        produces: operation.produces ?? document.produces ?? [] } : {}),
      parameters: [...parameters.values()], requestBody,
      responses: operation.responses ?? {},
      security: operation.security ?? document.security ?? [],
      securitySchemes: object(document.components).securitySchemes ?? document.securityDefinitions ?? {},
    }
    const expanded = expandReferences(document, detail, maxDepth)
    return { api: expanded.value, warnings: expanded.warnings,
      note: 'Documented contract only; no API is executed. Missing schemas are unknown, not inferred.' }
  }
}
