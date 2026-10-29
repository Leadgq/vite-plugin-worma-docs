import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { OpenApiRepository } from '../../openapi/repository'
import { annotations, result } from './shared'

export function registerGetApiDetail(server: McpServer, repository: OpenApiRepository) {
  server.registerTool('get_api_detail', {
    description: 'Read a documented API contract: parameter locations, required fields, request bodies, all response status codes/content types, schemas, examples and security requirements. Expands internal $refs; warnings identify circular, missing, external or truncated references. Never executes the API.',
    inputSchema: z.object({
      id: z.string().min(1).describe('Exact id returned by list_apis or search_apis'),
      maxDepth: z.number().int().min(1).max(20).default(8).describe('Maximum nested reference expansion depth'),
    }).strict(), annotations,
  }, ({ id, maxDepth }) => result(() => repository.detailFresh(id, maxDepth)))
}
