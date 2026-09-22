import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { wormaDocs } from '../src/index.ts'

const playgroundRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: playgroundRoot,
  plugins: [
    wormaDocs({
      swagger: 'https://petstore3.swagger.io/api/v3/openapi.json',
      output: 'aidocs',
      tags: ['pet'],
    }),
  ],
  server: {
    port: 5177,
  },
})
