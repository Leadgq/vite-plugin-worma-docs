import { z } from 'zod'
import { clientSettingsShape } from './client-config'

export const sourceSchema = z.object({
  name: z.string().trim().min(1),
  swagger: z.string().trim().min(1),
  tags: z.array(z.string().min(1)).optional(),
  ...clientSettingsShape,
}).strict()

export const configSchema = z.object({
  sources: z.array(sourceSchema).min(1),
  ...clientSettingsShape,
}).strict().superRefine(({ sources }, ctx) => {
  const names = sources.map(source => source.name)
  if (new Set(names).size !== names.length) {
    ctx.addIssue({ code: 'custom', message: 'Source names must be unique' })
  }
})

export type OpenApiSource = z.infer<typeof sourceSchema>
export type McpConfig = z.infer<typeof configSchema>
// OpenAPI is an extensible JSON format; unknown fields are retained verbatim.
export type JsonObject = { [key: string]: JsonValue }
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject

export function object(value: JsonValue | undefined): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export interface LoadedSource {
  source: OpenApiSource
  document: JsonObject
}

export interface ApiSummary {
  id: string
  source: string
  method: string
  path: string
  operationId?: string
  summary?: string
  tags: string[]
  deprecated: boolean
}

export interface ApiQuery {
  source?: string
  tag?: string
  method?: string
  query?: string
  offset?: number
  limit?: number
}
