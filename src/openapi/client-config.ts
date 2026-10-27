import { z } from 'zod'

export const clientOptionsSchema = z.object({
  output: z.string().trim().min(1).optional(),
  library: z.enum(['axios', 'fetch', 'ky']).optional(),
  type: z.enum(['typescript', 'module', 'commonjs']).optional(),
}).strict()

export const clientSettingsShape = {
  generateClient: z.boolean().optional(),
  client: clientOptionsSchema.optional(),
}

export type ClientOptions = z.infer<typeof clientOptionsSchema>
export interface ClientGenerationSettings {
  /** Explicit opt-in. Default false; no request code is generated. */
  generateClient?: boolean
  client?: ClientOptions
}
