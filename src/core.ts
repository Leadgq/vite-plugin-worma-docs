import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { generate as GenerateFn } from 'wormajs'
import { generateClients } from './openapi/generator'
import type { ClientGenerationSettings } from './openapi/client-config'
import type {
  aiDoc as AiDocFn,
  apiFilter as ApiFilterFn,
  swagger as SwaggerFn,
  FilterApiConfig,
} from 'wormajs/plugin'

export const PLUGIN_NAME = 'plugin-worma-docs'

export type { FilterApiConfig }
export type { ClientOptions, ClientGenerationSettings } from './openapi/client-config'

type ExclusiveFilter =
  | { tags?: string[], apiFilter?: never }
  | { tags?: never, apiFilter?: FilterApiConfig | FilterApiConfig[] }

export type WormaDocsSource = {
  /** OpenAPI / Swagger JSON URL or local path. */
  swagger: string
  /** Handbook output directory. Inherit top-level `output` if omitted. */
  output?: string
} & ExclusiveFilter & ClientGenerationSettings

type WormaDocsShared = {
  /**
   * OpenAPI / Swagger JSON URL or local path.
   * Pass a string for one spec, a string array for several independent specs,
   * or objects when each spec needs its own tags / output.
   */
  swagger: string | string[] | WormaDocsSource[]
  /** Handbook output directory, relative to the project root. Default `src/api/aidocs`. */
  output?: string
  /** Skip generation when false. Default true. */
  enable?: boolean
  /** Bypass worma cache and refetch the spec. Default false. */
  force?: boolean
}

export type WormaDocsOptions = WormaDocsShared & ExclusiveFilter & ClientGenerationSettings

const nodeRequire = createRequire(import.meta.url)
const { generate } = nodeRequire('wormajs') as { generate: typeof GenerateFn }
const { aiDoc, apiFilter, swagger } = nodeRequire('wormajs/plugin') as {
  aiDoc: typeof AiDocFn
  apiFilter: typeof ApiFilterFn
  swagger: typeof SwaggerFn
}

function templatesDir() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')
}

function asFilterList(
  value?: FilterApiConfig | FilterApiConfig[],
): FilterApiConfig[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function resolveApiFilter(source: WormaDocsSource): FilterApiConfig[] {
  if (source.apiFilter) {
    const tags = (source as { tags?: string[] }).tags
    if (tags?.length) {
      console.warn(`[${PLUGIN_NAME}] tags is ignored because apiFilter is set`)
    }
    return asFilterList(source.apiFilter)
  }
  return source.tags?.map(tag => ({
    scope: 'tag' as const,
    include: tag,
  })) ?? []
}

function pickFilter(
  item: string | WormaDocsSource,
  parent: ExclusiveFilter,
): ExclusiveFilter {
  if (typeof item === 'string') return parent
  if (item.apiFilter) return { apiFilter: item.apiFilter }
  if (item.tags) return { tags: item.tags }
  return parent
}

function normalizeSources(options: WormaDocsOptions): WormaDocsSource[] {
  const { swagger, output } = options
  const parentFilter: ExclusiveFilter = options.apiFilter
    ? { apiFilter: options.apiFilter }
    : { tags: options.tags }
  if (typeof swagger === 'string') {
    return [{ swagger, output, ...parentFilter }]
  }
  if (!swagger.length) {
    throw new Error(`[${PLUGIN_NAME}] swagger must not be empty`)
  }
  return swagger.map((item) => {
    if (typeof item === 'string') {
      return { swagger: item, output, ...parentFilter }
    }
    return {
      swagger: item.swagger,
      output: item.output ?? output,
      generateClient: item.generateClient,
      client: item.client,
      ...pickFilter(item, parentFilter),
    }
  })
}

function buildPlugins(source: WormaDocsSource, projectPath: string) {
  const docsOnlyPath = path.join(templatesDir(), 'docs-only')
  const skillPath = path.join(templatesDir(), 'http-skill')
  const aidocsAbs = path.resolve(projectPath, source.output ?? 'src/api/aidocs')
  const filters = resolveApiFilter(source)

  return [
    swagger(source.swagger),
    ...(filters.length ? [apiFilter(filters)] : []),
    {
      name: 'docs-only',
      getTemplate() {
        return { path: docsOnlyPath }
      },
    },
    aiDoc({
      template: skillPath,
      outputDir: aidocsAbs,
    }),
  ]
}

export async function generateWormaDocs(
  options: WormaDocsOptions,
  projectPath: string,
): Promise<void> {
  const sources = normalizeSources(options)
  const force = options.force ?? false

  for (const [index, source] of sources.entries()) {
    try {
      await generate(
        {
          generator: [
            {
              output: sources.length === 1 ? '.worma' : `.worma/${index}`,
              plugins: buildPlugins(source, projectPath),
            },
          ],
        },
        {
          force,
          projectPath,
        },
      )
    }
    catch (error) {
      logWormaDocsError(error, source.swagger)
    }
  }
  try {
    await generateClients(sources.map((source, index) => ({ ...source, name: `source-${index + 1}` })), options, projectPath)
  }
  catch (error) {
    console.warn(`[${PLUGIN_NAME}] failed to generate API client: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function logWormaDocsError(error: unknown, swaggerUrl?: string) {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  const from = swaggerUrl ? ` from ${swaggerUrl}` : ''
  console.warn(`[${PLUGIN_NAME}] failed to generate API docs${from}:\n${message}`)
}
