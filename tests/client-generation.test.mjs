import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, readFile, readdir, rm, access } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { OpenApiRepository } from '../dist/mcp.js'
import { wormaDocs } from '../dist/index.js'
const { WormaDocsWebpackPlugin } = createRequire(import.meta.url)('../dist/webpack.cjs')

const document = {
  openapi: '3.0.3', info: { title: 'Client fixture', version: '1.0' },
  servers: [{ url: 'https://api.invalid' }],
  paths: {
    '/users/{id}': { get: { operationId: 'getUser', tags: ['Users'], summary: 'Get user',
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'User', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
    } },
    '/users': { post: { operationId: 'createUser', tags: ['Users'],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
      responses: { 201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
    } },
    '/admin': { get: { operationId: 'getAdmin', tags: ['Admin'], responses: { 200: { description: 'OK' } } } },
  },
  components: { schemas: { User: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, age: { type: 'integer' } } } } },
}

async function filesBelow(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await filesBelow(filename))
    else result.push(filename)
  }
  return result
}

async function withProject(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worma-generate-test-'))
  try {
    await writeFile(path.join(directory, 'openapi.json'), JSON.stringify(document))
    await writeFile(path.join(directory, 'package.json'), '{"name":"client-test","type":"module"}')
    await run(directory)
  }
  finally { await rm(directory, { recursive: true, force: true }) }
}

test('client generation is off by default, explicit false overrides parent true', async () => {
  await withProject(async directory => {
    const source = { name: 'users', swagger: './openapi.json' }
    const repo = await OpenApiRepository.load({ sources: [source] }, directory)
    assert.deepEqual(await repo.generateClients({}, directory), [])
    assert.deepEqual(await repo.generateClients({ generateClient: false }, directory), [])
    assert.deepEqual((await readdir(directory)).sort(), ['openapi.json', 'package.json'])
    const disabled = await OpenApiRepository.load({ sources: [{ ...source, generateClient: false }] }, directory)
    assert.deepEqual(await disabled.generateClients({ generateClient: true }, directory), [])
  })
})

test('opt-in generates axios/fetch/ky clients with schemas and honors tag selection', async () => {
  await withProject(async directory => {
    const repo = await OpenApiRepository.load({ sources: [{ name: 'users', swagger: './openapi.json', tags: ['Users'] }] }, directory)
    for (const library of ['axios', 'fetch', 'ky']) {
      const output = `generated-${library}`
      const paths = await repo.generateClients({ generateClient: true, client: { library, output } }, directory)
      assert.deepEqual(paths, [path.join(directory, output)])
      const files = await filesBelow(paths[0])
      assert.ok(files.some(filename => filename.endsWith('.ts')))
      assert.ok(!files.some(filename => filename.endsWith('.md')))
      const code = (await Promise.all(files.filter(filename => filename.endsWith('.ts')).map(filename => readFile(filename, 'utf8')))).join('\n')
      assert.match(code, /\/users/)
      assert.doesNotMatch(code, /\/admin/)
      assert.match(code, /name/)
      for (const filename of files.filter(filename => filename.endsWith('.ts') && !filename.endsWith('.d.ts'))) {
        const compiled = ts.transpileModule(await readFile(filename, 'utf8'), {
          fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
        })
        assert.equal(compiled.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0)
      }
      // Repeating startup can regenerate directories marked as owned by this source.
      await repo.generateClients({ generateClient: true, client: { library, output } }, directory)
    }
    await assert.rejects(access(path.join(directory, '.worma-cache')), { code: 'ENOENT' })
  })
})

test('output validation protects existing files and rejects overlap and paths outside project', async () => {
  await withProject(async directory => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(path.join(directory, 'manual'))
    await writeFile(path.join(directory, 'manual', 'request.js'), '// handwritten')
    const source = { name: 'users', swagger: './openapi.json' }
    const repo = await OpenApiRepository.load({ sources: [source] }, directory)
    await assert.rejects(repo.generateClients({ generateClient: true, client: { output: 'manual' } }, directory), /not owned/)
    assert.equal(await readFile(path.join(directory, 'manual', 'request.js'), 'utf8'), '// handwritten')
    for (const output of ['.', '../outside']) {
      await assert.rejects(repo.generateClients({ generateClient: true, client: { output } }, directory), /subdirectory/)
    }
    const overlapping = await OpenApiRepository.load({ sources: [
      { ...source, client: { output: 'same' } },
      { ...source, name: 'second', client: { output: 'same/child' } },
    ] }, directory)
    await assert.rejects(overlapping.generateClients({ generateClient: true }, directory), /overlap/)
    await assert.rejects(access(path.join(directory, 'same')), { code: 'ENOENT' })
  })
})

test('Vite and Webpack both support opt-in generation; Vite regex/function filtering is retained', async () => {
  await withProject(async directory => {
    const options = { swagger: './openapi.json', output: 'handbook', generateClient: true,
      client: { output: 'vite-client', library: 'fetch', type: 'module' },
      apiFilter: { scope: 'url', include: url => /^\/users\//.test(url) },
    }
    const plugin = wormaDocs(options)
    plugin.configResolved({ root: directory })
    await plugin.buildStart()
    const files = await filesBelow(path.join(directory, 'vite-client'))
    assert.ok(files.some(filename => filename.endsWith('.js')))
    const code = (await Promise.all(files.filter(filename => filename.endsWith('.js')).map(filename => readFile(filename, 'utf8')))).join('\n')
    assert.match(code, /\/users\/\{id\}/)
    assert.doesNotMatch(code, /\/admin/)
    let beforeRun
    const webpack = new WormaDocsWebpackPlugin({ swagger: './openapi.json', output: 'webpack-handbook',
      generateClient: true, client: { output: 'webpack-client', library: 'axios', type: 'commonjs' }, tags: ['Users'] })
    webpack.apply({ context: directory, hooks: {
      beforeRun: { tapAsync(_name, run) { beforeRun = run } },
      watchRun: { tapAsync() {} },
    } })
    await new Promise((resolve, reject) => beforeRun(null, error => error ? reject(error) : resolve()))
    assert.ok((await filesBelow(path.join(directory, 'webpack-client'))).some(filename => filename.endsWith('.cjs')))
  })
})
