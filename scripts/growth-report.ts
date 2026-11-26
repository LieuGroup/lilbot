/** Printed at the end of verify so every PR shows growth: source lines per top-level folder, and the web app's first load
 *  (gzip -9 of every file `dist/index.html` references, the way the server serves it). Needs `dist/` from `bun run build`. */
import { firstLoad, kb } from './first-load'
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

const sizes = firstLoad()
console.log(`Web first load (gzip -9): ${kb(sizes.js)} JavaScript, ${kb(sizes.css)} styles`)
