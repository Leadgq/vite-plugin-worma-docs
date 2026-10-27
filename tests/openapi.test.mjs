import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OpenApiRepository, loadConfig } from '../dist/mcp.js'

function fixture() {
  return {
    openapi: '3.1.0', info: { title: 'Fixture', version: '1' },
    servers: [{ url: 'https://api.invalid' }], security: [{ bearer: [] }],
    paths: {
      '/orders/{id}': {
        parameters: [{ $ref: '#/components/parameters/Id' }, { in: 'query', name: 'verbose', schema: { type: 'boolean' } }],
        get: {
          summary: '订单详情', operationId: 'getOrder', tags: ['Orders'],
          parameters: [{ in: 'query', name: 'verbose', required: true, schema: { type: 'string', enum: ['full'] } }],
          responses: { 200: { $ref: '#/components/responses/Order' }, 404: { description: 'Not found' } },
        },
      },
      '/orders': { post: {
        tags: ['Orders'], description: 'Create an order', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Input' }, example: { quantity: 2 } } } },
        responses: { 201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } } },
      } },
      '/other': { delete: { tags: ['Other'], responses: { 204: { description: 'Deleted' } } } },
    },
    components: {
      parameters: { Id: { in: 'path', name: 'id', required: true, schema: { type: 'string' } } },
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      responses: { Order: { description: 'Order response', headers: { 'X-Request-Id': { schema: { type: 'string' } } }, content: {
        'application/json': { schema: { $ref: '#/components/schemas/Order' } },
      } } },
      schemas: {
        Input: { type: 'object', required: ['quantity'], properties: {
          quantity: { type: 'integer', minimum: 1, default: 1 },
          variant: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
        } },
        Order: { allOf: [{ $ref: '#/components/schemas/Input' }, { type: 'object', properties: {
          status: { type: 'string', enum: ['pending', 'paid'] },
          children: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
          external: { $ref: 'https://never-fetch.invalid/schema.json' },
          missing: { $ref: '#/components/schemas/Missing' },
        } }] },
      },
    },
  }
}

function repository(document = fixture(), tags) {
  return new OpenApiRepository([{ source: { name: 'orders', swagger: 'unused', tags }, document }])
}

test('search, pagination, source and tag filters retain stable API ids', () => {
  const repo = repository()
  assert.equal(repo.list().total, 3)
  const page = repo.list({ limit: 1 })
  assert.equal(page.nextOffset, 1)
  assert.equal(repo.list({ offset: 2 }).nextOffset, null)
  assert.equal(repo.list({ query: 'GETORDER 订单' }).total, 1)
  assert.equal(repo.list({ query: 'create order', method: 'POST' }).total, 1)
  assert.equal(repo.list({ source: 'orders', tag: 'Other' }).total, 1)
  assert.equal(repository(fixture(), ['Orders']).list().total, 2)
  assert.throws(() => repo.list({ source: 'missing' }), /Unknown source/)
  assert.throws(() => repo.detail('missing'), /Unknown API/)
})

test('detail resolves nested schemas, inherited parameters, responses and circular refs', () => {
  const repo = repository()
  const { api, warnings } = repo.detail('orders::GET /orders/{id}')
  assert.equal(api.parameters.length, 2)
  assert.equal(api.parameters.find(p => p.name === 'id').required, true)
  assert.equal(api.parameters.find(p => p.name === 'verbose').schema.type, 'string')
  assert.equal(api.responses[200].headers['X-Request-Id'].schema.type, 'string')
  const schema = api.responses[200].content['application/json'].schema
  assert.equal(schema.allOf[0].properties.quantity.minimum, 1)
  assert.deepEqual(schema.allOf[1].properties.status.enum, ['pending', 'paid'])
  assert.match(warnings.join('\n'), /circular reference/)
  assert.match(warnings.join('\n'), /external reference not loaded/)
  assert.match(warnings.join('\n'), /reference not found/)
  assert.equal(api.responses[404].description, 'Not found')
  assert.equal(api.securitySchemes.bearer.scheme, 'bearer')
  assert.equal(api.servers[0].url, 'https://api.invalid')
  const post = repo.detail('orders::POST /orders').api
  assert.equal(post.requestBody.required, true)
  assert.deepEqual(post.security, [])
  assert.deepEqual(post.requestBody.content['application/json'].schema.required, ['quantity'])
  assert.equal(post.requestBody.content['application/json'].schema.properties.variant.oneOf.length, 2)
  assert.match(repo.detail('orders::GET /orders/{id}', 1).warnings.join('\n'), /maximum reference depth/)
})

test('Swagger 2 keeps body/formData, consumes/produces, schemas and auth', () => {
  const repo = repository({
    swagger: '2.0', host: 'api.invalid', basePath: '/v1', schemes: ['https'], consumes: ['application/json'], produces: ['application/json'],
    securityDefinitions: { key: { type: 'apiKey', in: 'header', name: 'X-Key' } },
    paths: { '/upload': { post: {
      parameters: [{ in: 'body', name: 'body', required: true, schema: { $ref: '#/definitions/Input' } }, { in: 'formData', name: 'file', type: 'file' }],
      responses: { 200: { description: 'OK', schema: { type: 'array', items: { $ref: '#/definitions/Input' } } } },
    } } },
    definitions: { Input: { type: 'object', properties: { title: { type: 'string' } } } },
  })
  const { api } = repo.detail(repo.list().apis[0].id)
  assert.equal(api.requestBody.bodyParameters[0].schema.properties.title.type, 'string')
  assert.equal(api.requestBody.formDataParameters[0].type, 'file')
  assert.equal(api.responses[200].schema.items.properties.title.type, 'string')
  assert.deepEqual(api.produces, ['application/json'])
  assert.equal(api.basePath, '/v1')
})

test('config-relative JSON/YAML files, unique source names and invalid docs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worma-mcp-'))
  try {
    await writeFile(path.join(directory, 'api.yaml'), 'openapi: 3.0.3\ninfo: {title: YAML, version: "1"}\npaths:\n  /health:\n    get:\n      responses:\n        "200": {description: OK}\n')
    const configFile = path.join(directory, 'config.json')
    await writeFile(configFile, JSON.stringify({ sources: [{ name: 'yaml', swagger: './api.yaml' }] }))
    const config = await loadConfig(configFile)
    const repo = await OpenApiRepository.load(config, directory)
    assert.equal(repo.list().apis[0].path, '/health')
    await assert.rejects(OpenApiRepository.load({ sources: [config.sources[0], config.sources[0]] }, directory), /unique/)
    await writeFile(path.join(directory, 'bad.json'), '{"hello":true}')
    await assert.rejects(OpenApiRepository.load({ sources: [{ name: 'bad', swagger: './bad.json' }] }, directory), /Expected Swagger/)
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})
