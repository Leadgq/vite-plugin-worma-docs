import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

test('stdio handshake, read-only tools, validation, query and no subsequent network access', async () => {
  const requests = []
  const http = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ openapi: '3.0.3', paths: { '/health': { get: {
      summary: 'Health check', responses: { 200: { description: 'OK', content: {
        'application/json': { schema: { type: 'object', properties: { healthy: { type: 'boolean' } } } },
      } } },
    } } } }))
  })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worma-stdio-'))
  const configFile = path.join(directory, 'config.json')
  const configText = JSON.stringify({ sources: [{ name: 'health', swagger: `http://127.0.0.1:${http.address().port}/swagger.json` }] })
  await writeFile(configFile, configText)
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../dist/mcp-cli.js', import.meta.url)), '--config', configFile], stderr: 'pipe' })
  let stderr = ''
  transport.stderr?.on('data', chunk => { stderr += chunk })
  const client = new Client({ name: 'test', version: '1' })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_api_detail', 'list_apis', 'search_apis'])
    assert.ok(tools.every(tool => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint))
    const list = await client.callTool({ name: 'list_apis', arguments: {} })
    assert.equal(list.structuredContent.total, 1)
    const id = list.structuredContent.apis[0].id
    const search = await client.callTool({ name: 'search_apis', arguments: { query: 'health' } })
    assert.equal(search.structuredContent.apis[0].id, id)
    const detail = await client.callTool({ name: 'get_api_detail', arguments: { id } })
    assert.equal(detail.structuredContent.api.responses[200].content['application/json'].schema.properties.healthy.type, 'boolean')
    assert.equal((await client.callTool({ name: 'get_api_detail', arguments: { id: 'bad' } })).isError, true)
    assert.equal((await client.callTool({ name: 'list_apis', arguments: { limit: 1000 } })).isError, true)
    assert.equal((await client.callTool({ name: 'list_apis', arguments: { swagger: 'http://never-fetch.invalid' } })).isError, true)
    assert.deepEqual(requests, [{ method: 'GET', url: '/swagger.json' }])
    assert.equal(stderr, '')
    assert.equal(await (await import('node:fs/promises')).readFile(configFile, 'utf8'), configText)
  }
  finally {
    await client.close()
    await transport.close()
    await new Promise(resolve => http.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
