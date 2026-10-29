import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OpenApiRepository } from '../dist/mcp.js'

function specification(revision) {
  return { openapi: '3.0.3', info: { title: 'Refresh fixture', version: `${revision}` }, paths: {
    '/shared': { get: { responses: { 200: { description: 'OK', content: { 'application/json': { schema: {
      type: 'object', properties: { [`field${revision}`]: { type: 'string' } },
    } } } } } } },
    [`/revision-${revision}`]: { get: { responses: { 204: { description: 'No content' } } } },
  } }
}

async function fixture(run) {
  const revisions = { a: 1, b: 1 }
  const errors = {}
  const requests = { a: 0, b: 0 }
  const http = createServer((req, res) => {
    const key = req.url.slice(1)
    requests[key]++
    res.statusCode = errors[key] ? 503 : 200
    res.end(errors[key] ? 'unavailable' : JSON.stringify(specification(revisions[key])))
  })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worma-refresh-'))
  try {
    const url = `http://127.0.0.1:${http.address().port}`
    await run({ revisions, errors, requests, directory, url })
  }
  finally {
    await new Promise(resolve => http.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
}

test('expired queries reread Swagger, remove old APIs, update fields and coalesce concurrent loads', async t => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  await fixture(async ({ revisions, requests, directory, url }) => {
    const repo = await OpenApiRepository.load({ refreshIntervalSeconds: 1, sources: [{ name: 'a', swagger: `${url}/a` }] }, directory)
    const original = repo.list().sources[0].lastLoadedAt
    revisions.a = 2
    assert.ok((await repo.listFresh()).apis.some(api => api.path === '/revision-1'))
    assert.equal(requests.a, 1)
    now += 1001
    const queries = await Promise.all(Array.from({ length: 8 }, () => repo.listFresh()))
    assert.equal(requests.a, 2)
    assert.ok(queries.every(page => page.apis.some(api => api.path === '/revision-2')))
    assert.ok(queries.every(page => !page.apis.some(api => api.path === '/revision-1')))
    const detail = await repo.detailFresh('a::GET /shared')
    assert.ok(detail.api.responses[200].content['application/json'].schema.properties.field2)
    assert.equal(detail.freshness.stale, false)
    assert.notEqual(detail.freshness.lastLoadedAt, original)
    assert.equal(detail.freshness.lastLoadedAt, new Date(now).toISOString())
    await assert.rejects(repo.detailFresh('a::GET /revision-1'), /Unknown API/)
  })
})

test('manual refresh supports source selection, disabled auto refresh, failure fallback and recovery', async t => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  await fixture(async ({ revisions, requests, errors, directory, url }) => {
    const repo = await OpenApiRepository.load({ refreshIntervalSeconds: 0, sources: [
      { name: 'a', swagger: `${url}/a` }, { name: 'b', swagger: `${url}/b` },
    ] }, directory)
    revisions.a = 2
    revisions.b = 2
    now += 100000
    await repo.listFresh()
    assert.deepEqual(requests, { a: 1, b: 1 })
    assert.equal(repo.list().sources[0].automaticRefreshEnabled, false)
    await assert.rejects(repo.refresh('unknown'), /Unknown source/)
    await Promise.all([repo.refresh('a'), repo.refresh('a'), repo.refresh('a')])
    assert.deepEqual(requests, { a: 2, b: 1 })
    assert.ok(repo.list({ source: 'a' }).apis.some(api => api.path === '/revision-2'))
    errors.b = true
    const failed = await repo.refresh()
    assert.equal(failed.success, false)
    const status = failed.sources.find(source => source.name === 'b')
    assert.equal(status.stale, true)
    assert.match(status.lastRefreshError, /503/)
    assert.ok(repo.list({ source: 'b' }).apis.some(api => api.path === '/revision-1'))
    errors.b = false
    now++
    const recovered = await repo.refresh('b')
    assert.equal(recovered.success, true)
    assert.equal(recovered.sources[0].lastRefreshError, null)
    assert.ok(repo.list({ source: 'b' }).apis.some(api => api.path === '/revision-2'))
  })
})

test('automatic failures retain the last valid snapshot and back off; source intervals override defaults', async t => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  await fixture(async ({ revisions, requests, errors, directory, url }) => {
    const repo = await OpenApiRepository.load({ refreshIntervalSeconds: 1, sources: [
      { name: 'a', swagger: `${url}/a` }, { name: 'b', swagger: `${url}/b`, refreshIntervalSeconds: 0 },
    ] }, directory)
    const original = repo.list().sources[0].lastLoadedAt
    errors.a = true
    revisions.b = 2
    now += 1001
    const failed = await repo.listFresh()
    assert.equal(failed.sources[0].stale, true)
    assert.equal(failed.sources[0].lastLoadedAt, original)
    assert.deepEqual(requests, { a: 2, b: 1 })
    await repo.listFresh()
    assert.equal(requests.a, 2)
    errors.a = false
    revisions.a = 2
    now += 1001
    const recovered = await repo.listFresh({ source: 'a' })
    assert.equal(recovered.sources[0].stale, false)
    assert.equal(requests.a, 3)
    assert.equal(requests.b, 1)
  })
})

test('local files refresh too; missing or invalid documents never erase the previous data', async t => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worma-refresh-file-'))
  try {
    const filename = path.join(directory, 'openapi.json')
    await writeFile(filename, JSON.stringify(specification(1)))
    const repo = await OpenApiRepository.load({ sources: [{ name: 'local', swagger: './openapi.json' }] }, directory)
    assert.equal(repo.list().sources[0].refreshIntervalSeconds, 60)
    await writeFile(filename, JSON.stringify(specification(2)))
    now += 60001
    assert.ok((await repo.detailFresh('local::GET /shared')).api.responses[200].content['application/json'].schema.properties.field2)
    await writeFile(filename, '{"not":"openapi"}')
    assert.equal((await repo.refresh()).success, false)
    assert.ok(repo.list().apis.some(api => api.path === '/revision-2'))
    await rm(filename)
    assert.equal((await repo.refresh()).success, false)
    await assert.rejects(OpenApiRepository.load({ refreshIntervalSeconds: -1, sources: [{ name: 'local', swagger: filename }] }, directory))
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})
