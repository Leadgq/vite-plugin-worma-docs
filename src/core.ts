import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { generate as GenerateFn } from 'wormajs'
import type {
  aiDoc as AiDocFn,
  apiFilter as ApiFilterFn,
  swagger as SwaggerFn,
  FilterApiConfig,
} from 'wormajs/plugin'

export const PLUGIN_NAME = 'plugin-worma-docs'

export type { FilterApiConfig }

export interface WormaDocsSource {
  /** OpenAPI / Swagger JSON URL or local path. */
  swagger: string
  /** Only generate these OpenAPI tags. Inherit top-level `tags` if omitted. */
  tags?: string[]
  /**
   * Same as wormajs `apiFilter()`: filter by `url` or `tag`.
   * An array is a union (OR). Inherit top-level `apiFilter` if omitted.
   */
  apiFilter?: FilterApiConfig | FilterApiConfig[]
  /** Handbook output directory. Inherit top-level `output` if omitted. */
  output?: string
}

export interface WormaDocsOptions {
  /**
   * OpenAPI / Swagger JSON URL or local path.
   * Pass a string for one spec, a string array for several independent specs,
   * or objects when each spec needs its own tags / output.
   */
  swagger: string | string[] | WormaDocsSource[]
  /** Handbook output directory, relative to the project root. Default `src/api/aidocs`. */
  output?: string
  /** Only generate these OpenAPI tags. Omit to include every tag. */
  tags?: string[]
  /**
   * Same as wormajs `apiFilter()`. Use this to keep a single path, not a whole tag.
   * `tags` is still a shortcut for `{ scope: 'tag', include }`.
   */
  apiFilter?: FilterApiConfig | FilterApiConfig[]
  /** Skip generation when false. Default true. */
  enable?: boolean
  /** Bypass worma cache and refetch the spec. Default false. */
  force?: boolean
}

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
  const fromTags = source.tags?.map(tag => ({
    scope: 'tag' as const,
    include: tag,
  })) ?? []
  return [...fromTags, ...asFilterList(source.apiFilter)]
}

function normalizeSources(options: WormaDocsOptions): WormaDocsSource[] {
  const { swagger, tags, output, apiFilter: filter } = options
  if (typeof swagger === 'string') {
    return [{ swagger, tags, output, apiFilter: filter }]
  }
  if (!swagger.length) {
    throw new Error(`[${PLUGIN_NAME}] swagger must not be empty`)
  }
  return swagger.map((item) => {
    if (typeof item === 'string') {
      return { swagger: item, tags, output, apiFilter: filter }
    }
    return {
      swagger: item.swagger,
      tags: item.tags ?? tags,
      output: item.output ?? output,
      apiFilter: item.apiFilter ?? filter,
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
}

export function logWormaDocsError(error: unknown, swaggerUrl?: string) {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  const from = swaggerUrl ? ` from ${swaggerUrl}` : ''
  console.warn(`[${PLUGIN_NAME}] failed to generate API docs${from}:\n${message}`)
}
