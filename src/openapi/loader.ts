import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { configSchema, object, type JsonObject, type LoadedSource, type McpConfig, type OpenApiSource } from './types'

const MAX_BYTES = 20 * 1024 * 1024

async function readLocal(filename: string): Promise<string> {
  if ((await stat(filename)).size > MAX_BYTES) throw new Error('File exceeds 20 MiB')
  return readFile(filename, 'utf8')
}

export async function loadConfig(filename: string): Promise<McpConfig> {
  return configSchema.parse(JSON.parse(await readLocal(filename)))
}

async function readRemote(url: URL): Promise<string> {
  // URLs come only from startup configuration. Queries/refresh cannot select arbitrary URLs or external $refs.
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error', cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (!response.body) throw new Error('Empty response body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) throw new Error('Document exceeds 20 MiB')
      chunks.push(value)
    }
  }
  finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function parseDocument(text: string): JsonObject {
  // JSON round trip rejects YAML cycles and produces plain JSON data.
  const document = object(JSON.parse(JSON.stringify(parse(text, { maxAliasCount: 50 }))))
  const version = document.openapi ?? document.swagger
  if (!(version === '2.0' || (typeof version === 'string' && /^3\.(0|1)\./.test(version)))) {
    throw new Error('Expected Swagger 2.0 or OpenAPI 3.0 / 3.1 document')
  }
  if (!document.paths || typeof document.paths !== 'object' || Array.isArray(document.paths)) {
    throw new Error('OpenAPI paths must be an object')
  }
  return document
}

export async function loadSource(source: OpenApiSource, baseDir: string): Promise<LoadedSource> {
  try {
    const text = /^https?:\/\//i.test(source.swagger)
      ? await readRemote(new URL(source.swagger))
      : await readLocal(path.resolve(baseDir, source.swagger))
    return { source, document: parseDocument(text), loadedAt: Date.now() }
  }
  catch (error) {
    // Avoid printing configured URLs (which may contain credentials).
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot load source "${source.name}": ${message}`)
  }
}
