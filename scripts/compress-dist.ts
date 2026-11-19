/** After `vite build`: writes a brotli and a gzip copy beside each text file in `dist/`, once per
 *  release, so the server sends compressed files without compressing on each request. */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const DIST = join(import.meta.dir, '..', 'dist')
const TEXT = new Set(['.js', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt'])
const MIN_BYTES = 1024

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (TEXT.has(extname(entry.name)) && statSync(path).size >= MIN_BYTES) yield path
  }
}

let raw = 0
let compressed = 0
for (const path of files(DIST)) {
  const data = readFileSync(path)
  const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
  writeFileSync(`${path}.br`, br)
  writeFileSync(`${path}.gz`, gzipSync(data, { level: 9 }))
  raw += data.length
  compressed += br.length
}
console.log(`compressed dist: ${raw} bytes -> ${compressed} bytes (brotli)`)
