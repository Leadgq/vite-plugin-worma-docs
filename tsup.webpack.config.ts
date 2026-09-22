import { defineConfig } from 'tsup'

export default defineConfig({
  minify: true,
  splitting: false,
  sourcemap: true,
  target: 'node18',
  clean: false,
  shims: true,
  outExtension: () => ({ js: '.cjs' }),
  external: ['vite', 'webpack', 'wormajs', 'wormajs/plugin'],
  entry: { webpack: 'src/webpack.ts' },
  format: ['cjs'],
  dts: true,
  esbuildOptions(options) {
    options.keepNames = true
  },
})
