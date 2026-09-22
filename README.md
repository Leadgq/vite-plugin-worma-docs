# vite-plugin-worma-docs

Vite / Webpack plugin that turns an OpenAPI spec into a local handbook: method, path, request fields, response fields. No generated HTTP client.

## Vite

```ts
import { defineConfig } from 'vite'
import { wormaDocs } from 'vite-plugin-worma-docs'

export default defineConfig({
  plugins: [
    wormaDocs({
      swagger: 'https://petstore3.swagger.io/api/v3/openapi.json',
      output: 'src/api/aidocs',
      tags: ['pet', 'store'],
    }),
  ],
})
```

## Webpack 5

```js
const { WormaDocsWebpackPlugin } = require('vite-plugin-worma-docs/webpack')

module.exports = {
  plugins: [
    new WormaDocsWebpackPlugin({
      swagger: 'https://petstore3.swagger.io/api/v3/openapi.json',
      output: 'src/api/aidocs',
    }),
  ],
}
```

## Options

| Name | Default | Description |
| --- | --- | --- |
| `swagger` | required | OpenAPI / Swagger JSON URL or path |
| `output` | `src/api/aidocs` | Handbook directory, relative to project root |
| `tags` | all tags | Only generate these OpenAPI tags |
| `enable` | `true` | Skip generation when `false` |
| `force` | `false` | Ignore worma cache and refetch the spec |

Generation runs once on Vite `buildStart` and once on Webpack `beforeRun` / first `watchRun`. A failed fetch logs a warning and does not fail the build.
