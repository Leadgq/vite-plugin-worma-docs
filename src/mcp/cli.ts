#!/usr/bin/env node
import process from 'node:process'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createWormaMcpServer, loadConfig, OpenApiRepository } from './index'

async function main() {
  const { values } = parseArgs({ options: {
    config: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  }, strict: true, allowPositionals: false })
  if (values.help) {
    process.stderr.write('Usage: worma-docs-mcp --config /absolute/path/worma-mcp.json\nRead-only OpenAPI MCP server (stdio). Local Swagger paths resolve relative to the config file.\n')
    return
  }
  if (!values.config) throw new Error('Missing --config. Run worma-docs-mcp --help for usage.')
  const filename = path.resolve(values.config)
  const config = await loadConfig(filename)
  const baseDir = path.dirname(filename)
  const repository = await OpenApiRepository.load(config, baseDir)
  const generated = await repository.generateClients(config, baseDir)
  for (const output of generated) process.stderr.write(`[worma-docs-mcp] Generated client: ${output}\n`)
  const server = createWormaMcpServer(repository)
  await server.connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  process.stderr.write(`[worma-docs-mcp] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
