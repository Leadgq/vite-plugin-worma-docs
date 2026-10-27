import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { OpenApiRepository } from '../../openapi/repository'
import { annotations, queryShape, result } from './shared'

export function registerListApis(server: McpServer, repository: OpenApiRepository) {
  server.registerTool('list_apis', {
    description: 'List documented APIs and available source names. Returns paginated summaries and stable ids; use get_api_detail for request/response schemas.',
    inputSchema: z.object(queryShape).strict(), annotations,
  }, args => result(() => repository.list(args)))
}
