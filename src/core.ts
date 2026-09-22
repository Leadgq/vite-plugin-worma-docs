import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { generate as GenerateFn } from 'wormajs'
import type { aiDoc as AiDocFn, apiFilter as ApiFilterFn, swagger as SwaggerFn } from 'wormajs/plugin'

export const PLUGIN_NAME = 'plugin-worma-docs'

export interface WormaDocsOptions {
  /** OpenAPI / Swagger JSON URL or local path. */
  swagger: string
  /** Handbook output directory, relative to the project root. Default `src/api/aidocs`. */
  output?: string
  /** Only generate these OpenAPI tags. Omit to include every tag. */
  tags?: string[]
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

export async function generateWormaDocs(
  options: WormaDocsOptions,
  projectPath: string,
): Promise<void> {
  const output = options.output ?? 'src/api/aidocs'
  const docsOnlyPath = path.join(templatesDir(), 'docs-only')
  const skillPath = path.join(templatesDir(), 'http-skill')
  const aidocsAbs = path.resolve(projectPath, output)

  const plugins = [
    swagger(options.swagger),
    ...(options.tags?.length
      ? [apiFilter(options.tags.map(tag => ({ scope: 'tag' as const, include: tag })))]
      : []),
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

  await generate(
    {
      generator: [
        {
          output: '.worma',
          plugins,
        },
      ],
    },
    {
      force: options.force ?? false,
      projectPath,
    },
  )
}

export function logWormaDocsError(error: unknown) {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.warn(`[${PLUGIN_NAME}] failed to generate API docs:\n${message}`)
}
