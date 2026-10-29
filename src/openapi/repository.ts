import { loadSource } from './loader'
import { generateClients } from './generator'
import type { ClientGenerationSettings } from './client-config'
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

interface SourceState {
  loadedAt: number
  attemptedAt: number
  error?: string
  inflight?: Promise<void>
}

export class OpenApiRepository {
  private entries: Map<string, Entry>
  private readonly states = new Map<string, SourceState>()

  constructor(private sources: LoadedSource[], private readonly baseDir?: string, private readonly refreshIntervalSeconds = 60) {
    this.entries = OpenApiRepository.buildEntries(sources)
    for (const { source, loadedAt = Date.now() } of sources) {
      this.states.set(source.name, { loadedAt, attemptedAt: loadedAt })
    }
  }

  private static buildEntries(sources: LoadedSource[]) {
    const entries = new Map<string, Entry>()
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
          entries.set(id, { summary, loaded, pathItem, operation })
        }
      }
    }
    return entries
  }

  static async load(config: McpConfig, baseDir: string): Promise<OpenApiRepository> {
    const checked = configSchema.parse(config)
    // Sequential loading keeps request concurrency bounded for internal gateways.
    const loaded: LoadedSource[] = []
    for (const source of checked.sources) loaded.push(await loadSource(source, baseDir))
    return new OpenApiRepository(loaded, baseDir, checked.refreshIntervalSeconds ?? 60)
  }

  private selectedSources(name?: string) {
    if (name && !this.states.has(name)) throw new Error(`Unknown source: ${name}`)
    return this.sources.filter(({ source }) => !name || source.name === name)
  }

  private sourceStatus(name: string) {
    const { source } = this.sources.find(item => item.source.name === name)!
    const state = this.states.get(name)!
    const interval = source.refreshIntervalSeconds ?? this.refreshIntervalSeconds
    return {
      name,
      lastLoadedAt: new Date(state.loadedAt).toISOString(),
      lastRefreshAttemptAt: new Date(state.attemptedAt).toISOString(),
      refreshIntervalSeconds: interval,
      automaticRefreshEnabled: Boolean(this.baseDir) && interval > 0,
      stale: Boolean(state.error) || (interval > 0 && Date.now() - state.loadedAt >= interval * 1000),
      lastRefreshError: state.error ?? null,
    }
  }

  private async refreshSource(name: string, force: boolean): Promise<void> {
    const state = this.states.get(name)!
    if (state.inflight) return state.inflight
    const { source } = this.sources.find(item => item.source.name === name)!
    const interval = source.refreshIntervalSeconds ?? this.refreshIntervalSeconds
    // Failed automatic attempts also back off for one interval; explicit refresh bypasses this.
    const checkedAt = state.error ? state.attemptedAt : state.loadedAt
    if (!force && (interval === 0 || Date.now() - checkedAt < interval * 1000)) return
    state.attemptedAt = Date.now()
    state.inflight = (async () => {
      try {
        const loaded = await loadSource(source, this.baseDir!)
        const nextSources = this.sources.map(item => item.source.name === name ? loaded : item)
        const nextEntries = OpenApiRepository.buildEntries(nextSources)
        // Swap only complete, parsed snapshots. Queries never see half-built indexes.
        this.sources = nextSources
        this.entries = nextEntries
        state.loadedAt = loaded.loadedAt!
        state.error = undefined
      }
      catch (error) {
        state.error = error instanceof Error ? error.message : String(error)
      }
      finally { state.inflight = undefined }
    })()
    return state.inflight
  }

  /** Refresh expired configured sources; does not execute APIs or generate files. */
  async ensureFresh(source?: string): Promise<void> {
    const selected = this.selectedSources(source)
    if (!this.baseDir) return
    for (const item of selected) await this.refreshSource(item.source.name, false)
  }

  /** Force rereading configured sources, even when automatic refresh is disabled. */
  async refresh(source?: string) {
    const selected = this.selectedSources(source)
    if (!this.baseDir) throw new Error('Refresh requires a repository created with OpenApiRepository.load')
    for (const item of selected) await this.refreshSource(item.source.name, true)
    const sources = selected.map(item => this.sourceStatus(item.source.name))
    return { success: sources.every(item => item.lastRefreshError === null), sources,
      note: 'Only configured Swagger documents were reread. No API was executed and no client code was generated.' }
  }

  async listFresh(query: ApiQuery = {}) {
    await this.ensureFresh(query.source)
    return this.list(query)
  }

  async detailFresh(id: string, maxDepth = 8) {
    await this.ensureFresh(this.entries.get(id)?.summary.source)
    return this.detail(id, maxDepth)
  }

  /** Explicit configuration action, separate from the read-only MCP tools. */
  async generateClients(settings: ClientGenerationSettings, baseDir: string): Promise<string[]> {
    return generateClients(this.sources.map(({ source, document }) => ({ ...source, document })), settings, baseDir)
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
        ...this.sourceStatus(source.name), info: document.info,
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
    return { api: expanded.value, warnings: expanded.warnings, freshness: this.sourceStatus(summary.source),
      note: 'Documented contract only; no API is executed. Missing schemas are unknown, not inferred.' }
  }
}
