/** The web app's first load, measured the way the server serves it: gzip -9 of every file `dist/index.html` references.
 *  Shared by the growth report and the budget check. Needs `dist/` from `bun run build`. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

export const DIST = join(import.meta.dir, '..', 'dist')

export function firstLoad(dist = DIST) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const referenced = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map(m => m[1])
  const sizes = { js: 0, css: 0 }
  for (const file of new Set(referenced)) {
    const bytes = gzipSync(readFileSync(join(dist, file)), { level: 9 }).length
    if (file.endsWith('.css')) sizes.css += bytes
    else sizes.js += bytes
  }
  return sizes
}

export const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`
