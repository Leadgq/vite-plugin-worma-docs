import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const cts = join(dist, 'webpack.d.cts')
const dts = join(dist, 'webpack.d.ts')
if (existsSync(cts)) copyFileSync(cts, dts)
