import process from 'node:process'
import type { Plugin } from 'vite'
import {
  PLUGIN_NAME,
  generateWormaDocs,
  logWormaDocsError,
  type WormaDocsOptions,
  type WormaDocsSource,
} from './core'

export type { WormaDocsOptions, WormaDocsSource }

export function wormaDocs(options: WormaDocsOptions): Plugin {
  const { enable = true } = options
  let root = process.cwd()

  if (!enable) {
    return { name: PLUGIN_NAME }
  }

  return {
    name: PLUGIN_NAME,
    configResolved(config) {
      root = config.root
    },
    async buildStart() {
      try {
        await generateWormaDocs(options, root)
      }
      catch (error) {
        logWormaDocsError(error)
      }
    },
  }
}
