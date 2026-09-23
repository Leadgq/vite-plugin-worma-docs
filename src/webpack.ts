import type { Compiler } from 'webpack'
import {
  PLUGIN_NAME,
  generateWormaDocs,
  logWormaDocsError,
  type WormaDocsOptions,
  type WormaDocsSource,
} from './core'

export type { WormaDocsOptions, WormaDocsSource }

export class WormaDocsWebpackPlugin {
  private generatedOnce = false
  private inflight: Promise<void> | null = null

  constructor(private readonly options: WormaDocsOptions) {}

  apply(compiler: Compiler) {
    const { enable = true, force = false } = this.options
    if (!enable) return

    const run = (callback: (error?: Error) => void) => {
      void this.generate(compiler.context, force).then(
        () => callback(),
        () => callback(),
      )
    }

    compiler.hooks.beforeRun.tapAsync(PLUGIN_NAME, (_compiler, callback) => {
      run(callback)
    })
    compiler.hooks.watchRun.tapAsync(PLUGIN_NAME, (_compiler, callback) => {
      run(callback)
    })
  }

  private generate(projectPath: string, force: boolean) {
    if (!force && this.generatedOnce) return Promise.resolve()
    if (this.inflight) return this.inflight

    this.inflight = generateWormaDocs(this.options, projectPath)
      .catch((error) => {
        logWormaDocsError(error)
      })
      .finally(() => {
        this.generatedOnce = true
        this.inflight = null
      })

    return this.inflight
  }
}
