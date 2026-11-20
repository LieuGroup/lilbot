/** Printed at the end of verify so every PR shows growth: source lines per top-level folder, and the web app's first load
 *  (gzip -9 of every file `dist/index.html` references, the way the server serves it). Needs `dist/` from `bun run build`. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { trackedSourceFiles } from './source-files'

const folders = new Map<string, { files: number; lines: number }>()
for (const { path, lines } of await trackedSourceFiles()) {
  const folder = path.includes('/') ? path.slice(0, path.indexOf('/')) : '(root)'
  const entry = folders.get(folder) ?? { files: 0, lines: 0 }
  folders.set(folder, { files: entry.files + 1, lines: entry.lines + lines })
}
const rows = [...folders].sort((a, b) => b[1].lines - a[1].lines)
const total = rows.reduce((sum, [, e]) => ({ files: sum.files + e.files, lines: sum.lines + e.lines }), { files: 0, lines: 0 })
console.log('Source lines (tracked .ts, .tsx, .py):')
for (const [folder, e] of rows) console.log(`  ${folder.padEnd(12)} ${String(e.files).padStart(4)} files ${String(e.lines).padStart(7)} lines`)
console.log(`  ${'total'.padEnd(12)} ${String(total.files).padStart(4)} files ${String(total.lines).padStart(7)} lines`)

const dist = join(import.meta.dir, '..', 'dist')
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const referenced = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map(m => m[1])
const sizes = { js: 0, css: 0 }
for (const file of new Set(referenced)) {
  const bytes = gzipSync(readFileSync(join(dist, file)), { level: 9 }).length
  if (file.endsWith('.css')) sizes.css += bytes
  else sizes.js += bytes
}
const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`
console.log(`Web first load (gzip -9): ${kb(sizes.js)} JavaScript, ${kb(sizes.css)} styles`)
