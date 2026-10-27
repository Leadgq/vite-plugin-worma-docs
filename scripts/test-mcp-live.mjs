import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Opt-in smoke test: fetches only the configured Swagger document, never business endpoints.
const generateClient = process.argv.includes('--generate-client')
let configPath = fileURLToPath(new URL('../playground-mcp/worma-mcp.json', import.meta.url))
let scratch
if (generateClient) {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'worma-live-client-'))
  const original = JSON.parse(await readFile(configPath, 'utf8'))
  configPath = path.join(scratch, 'worma-mcp.json')
  await writeFile(configPath, JSON.stringify({ ...original, generateClient: true,
    client: { output: 'generated', library: 'axios', type: 'module' } }))
}
const transport = new StdioClientTransport({ command: process.execPath, args: [
  fileURLToPath(new URL('../dist/mcp-cli.js', import.meta.url)), '--config',
  configPath,
], stderr: 'pipe' })
let stderr = ''
transport.stderr?.on('data', chunk => { stderr += chunk })
const client = new Client({ name: 'worma-live-test', version: '1' })
try {
  await client.connect(transport)
  const { tools } = await client.listTools()
  assert.equal(tools.length, 3)
  const listed = await client.callTool({ name: 'list_apis', arguments: { limit: 100 } })
  assert.ok(!listed.isError)
  const { total, apis } = listed.structuredContent
  assert.ok(total > 0, 'Swagger should contain APIs')
  const selected = apis.find(api => api.method === 'POST') ?? apis[0]
  const found = await client.callTool({ name: 'search_apis', arguments: { query: selected.path } })
  assert.ok(found.structuredContent.total > 0)
  const detailed = await client.callTool({ name: 'get_api_detail', arguments: { id: selected.id } })
  assert.ok(!detailed.isError)
  const { api, warnings } = detailed.structuredContent
  assert.ok(Object.keys(api.responses).length > 0)
  function countProperties(value) {
    if (!value || typeof value !== 'object') return 0
    return (value.properties ? Object.keys(value.properties).length : 0)
      + Object.values(value).reduce((total, item) => total + countProperties(item), 0)
  }
  const requestFields = countProperties(api.requestBody) + countProperties(api.parameters)
  const responseFields = countProperties(api.responses)
  assert.ok(requestFields > 0 || api.parameters.length > 0, 'Expected documented input fields')
  assert.ok(responseFields > 0, 'Expected expanded response fields')
  let generatedFiles
  if (generateClient) {
    const generatedDir = path.join(scratch, 'generated')
    const entries = await readdir(generatedDir, { recursive: true })
    generatedFiles = entries.filter(filename => filename.endsWith('.js'))
    assert.ok(generatedFiles.length > 0)
    const code = (await Promise.all(generatedFiles.map(filename => readFile(path.join(generatedDir, filename), 'utf8')))).join('\n')
    assert.ok(code.includes(selected.path), 'Generated client should contain the selected real endpoint')
    assert.ok(code.includes('axios'), 'Generated client should use Axios')
  }
  console.log(JSON.stringify({ tools: tools.map(tool => tool.name), total, method: api.method,
    path: api.path, requestFields, responseFields, warnings, generatedJavaScriptFiles: generatedFiles?.length }, null, 2))
}
catch (error) {
  if (stderr) process.stderr.write(stderr)
  throw error
}
finally {
  await client.close()
  await transport.close()
  if (scratch) await rm(scratch, { recursive: true, force: true })
}
