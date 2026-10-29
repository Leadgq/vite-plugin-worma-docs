import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { OpenApiRepository } from '../../openapi/repository'
import { annotations, result } from './shared'

export function registerRefreshApis(server: McpServer, repository: OpenApiRepository) {
  server.registerTool('refresh_apis', {
    description: 'Immediately reread configured Swagger/OpenAPI sources after backend changes. Optionally select one source by name; omit to refresh all. Returns last successful load times and refresh errors. Failed sources retain their last valid snapshot. Does not execute APIs, modify Swagger, or regenerate request code.',
    inputSchema: z.object({ source: z.string().min(1).optional() }).strict(), annotations,
  }, async ({ source }) => {
    const response = await result(() => repository.refresh(source))
    if (response.structuredContent?.success === false) response.isError = true
    return response
  })
}
