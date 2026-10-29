import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export const queryShape = {
  source: z.string().min(1).optional().describe('Exact configured source name; omit to search all sources'),
  tag: z.string().min(1).optional().describe('Exact API tag'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
}

export const annotations = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true,
}

export async function result(run: () => unknown | Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await run() as Record<string, unknown>
    return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
  }
  catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }
  }
}
