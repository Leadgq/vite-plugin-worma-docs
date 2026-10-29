import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { OpenApiRepository } from '../../openapi/repository'
import { annotations, queryShape, result } from './shared'

export function registerSearchApis(server: McpServer, repository: OpenApiRepository) {
  server.registerTool('search_apis', {
    description: 'Search API paths, summaries, descriptions, operationIds and tags. Case-insensitive; all whitespace-separated terms must match. Returns summaries; fetch details by id.',
    inputSchema: z.object({ ...queryShape, query: z.string().trim().min(1).max(500) }).strict(), annotations,
  }, args => result(() => repository.listFresh(args)))
}
