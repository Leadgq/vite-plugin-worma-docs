import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { clientOptionsSchema, type ClientGenerationSettings, type ClientOptions } from './client-config'
import { loadSource } from './loader'
import { object, type JsonObject, type OpenApiSource } from './types'
import { resolveObject } from './references'
import type { FilterApiConfig, filterApiDescriptor as FilterApiDescriptor } from 'wormajs/plugin'

export type { ClientOptions, ClientGenerationSettings } from './client-config'

export interface ClientSource extends ClientGenerationSettings {
  name: string
  swagger: string
  tags?: string[]
  apiFilter?: FilterApiConfig | FilterApiConfig[]
  document?: JsonObject
}

// Run worma in isolation: its logger and global cache must never affect stdio MCP.
// Job data travels over stdin, not shell interpolation. This code never executes API endpoints.
const WORKER = String.raw`
process.stdout.write = process.stderr.write.bind(process.stderr);
let jobText = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { jobText += chunk; });
process.stdin.on('end', async () => {
  try {
    const job = JSON.parse(jobText);
    const { generate } = require(job.wormaPath);
    const plugins = require(job.pluginPath);
    const results = await generate({ generator: [{
      input: job.input, output: job.output, type: job.type,
      performance: { workerPool: false },
      plugins: [plugins[job.library]()],
    }] }, { projectPath: job.scratch, force: true });
    if (results.length !== 1 || results[0] !== true) throw new Error('worma did not generate the client');
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
});
`

const markerName = '.worma-client.json'
const require = createRequire(import.meta.url)

function filteredDocument(document: JsonObject, source: ClientSource): JsonObject {
  const filters = source.apiFilter ? (Array.isArray(source.apiFilter) ? source.apiFilter : [source.apiFilter]) : []
  if (!filters.length && !source.tags?.length) return document
  // Evaluate functions/RegExp in the caller, so closures survive worker isolation.
  const { filterApiDescriptor } = require('wormajs/plugin') as { filterApiDescriptor: typeof FilterApiDescriptor }
  const paths: JsonObject = {}
  for (const [apiPath, raw] of Object.entries(object(document.paths))) {
    const pathItem = { ...resolveObject(document, raw) }
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']) {
      if (!pathItem[method]) continue
      const operation = object(pathItem[method])
      const descriptor = { ...operation, url: apiPath } as Parameters<typeof FilterApiDescriptor>[0]
      const keep = filters.length ? Boolean(filterApiDescriptor(descriptor, filters))
        : source.tags!.some(tag => Array.isArray(operation.tags) && operation.tags.includes(tag))
      if (!keep) delete pathItem[method]
    }
    paths[apiPath] = pathItem
  }
  return { ...document, paths }
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

async function canonicalOutput(root: string, requested: string): Promise<string> {
  const target = path.resolve(root, requested)
  if (!inside(root, target)) throw new Error('Client output must be a subdirectory of the project/config directory')
  // Resolve existing ancestors so junctions/symlinks cannot redirect output outside the project.
  let ancestor = target
  const missing: string[] = []
  for (;;) {
    try {
      const resolved = path.join(await realpath(ancestor), ...missing.reverse())
      if (!inside(root, resolved)) throw new Error('Client output resolves outside the project/config directory')
      return resolved
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      missing.push(path.basename(ancestor))
      ancestor = path.dirname(ancestor)
    }
  }
}

async function checkOwnership(output: string, source: string) {
  let files: string[]
  try { files = await readdir(output) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!files.length) return
  try {
    const marker = JSON.parse(await readFile(path.join(output, markerName), 'utf8'))
    if (marker.generator === 'plugin-worma-docs' && marker.source === source) return
  }
  catch { /* Nonempty user directories must not be overwritten. */ }
  throw new Error(`Client output is not owned by this source: ${output}. Choose a new dedicated directory.`)
}

async function runWorker(job: Record<string, unknown>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', WORKER], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    let errors = ''
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-16_000) })
    child.once('error', reject)
    child.stdin.on('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Client generation failed:\n${errors}`)))
    child.stdin.end(JSON.stringify(job))
  })
}

/** Startup/build action only; never exposed as an MCP tool. Disabled calls perform no IO. */
export async function generateClients(
  sources: ClientSource[], settings: ClientGenerationSettings, projectPath: string,
): Promise<string[]> {
  const enabled = sources.map((source, index) => ({ source, index }))
    .filter(({ source }) => source.generateClient ?? settings.generateClient ?? false)
  if (!enabled.length) return []
  const root = await realpath(projectPath)
  const plans: { source: ClientSource, client: ClientOptions, output: string, document: JsonObject }[] = []
  for (const { source, index } of enabled) {
    const client = clientOptionsSchema.parse({ ...settings.client, ...source.client })
    const baseOutput = settings.client?.output ?? 'src/api/generated'
    const requested = source.client?.output ?? (sources.length > 1 ? path.join(baseOutput, `source-${index + 1}`) : baseOutput)
    const output = await canonicalOutput(root, requested)
    await checkOwnership(output, source.name)
    if (plans.some(plan => plan.output === output || inside(plan.output, output) || inside(output, plan.output))) {
      throw new Error('Client output directories must not overlap between sources')
    }
    const document = source.document ?? (await loadSource(source as OpenApiSource, root)).document
    plans.push({ source, client, output, document: filteredDocument(document, source) })
  }
  const generated: string[] = []
  for (const { source, client, output, document } of plans) {
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'worma-client-'))
    try {
      const input = path.join(scratch, 'openapi.json')
      const stagedOutput = path.join(scratch, 'client')
      await writeFile(input, JSON.stringify(document))
      await runWorker({
        input, output: stagedOutput, scratch, library: client.library ?? 'axios', type: client.type ?? 'typescript',
        wormaPath: require.resolve('wormajs'), pluginPath: require.resolve('wormajs/plugin'),
      })
      // Only copy a successful generation; retry ownership checks after the worker finishes.
      if (await canonicalOutput(root, output) !== output) throw new Error('Client output changed during generation')
      await checkOwnership(output, source.name)
      await cp(stagedOutput, output, { recursive: true })
      await writeFile(path.join(output, markerName), JSON.stringify({ generator: 'plugin-worma-docs', source: source.name }, null, 2))
      generated.push(output)
    }
    finally {
      // mkdtemp returns a newly created private directory under the OS temp directory.
      await rm(scratch, { recursive: true, force: true })
    }
  }
  return generated
}
