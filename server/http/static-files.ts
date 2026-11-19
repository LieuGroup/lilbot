/** The built web app's files. Hashed files under /assets/ never change, so browsers keep them for a
 *  year; every other file (index.html, icons, manifest) is checked again on each visit with its ETag.
 *  Text files go out brotli- or gzip-compressed from copies made at build time (scripts/compress-dist.ts). */
import { join, normalize } from 'node:path'

const IMMUTABLE = 'public, max-age=31536000, immutable'
const REVALIDATE = 'no-cache'

/** The encodings the browser accepts, in our order of preference. */
function accepted(header: string | null): ('br' | 'gzip')[] {
  const offered = new Map<string, number>()
  for (const part of (header ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    const q = params.map(p => p.trim()).find(p => p.startsWith('q='))
    offered.set(name, q ? Number(q.slice(2)) : 1)
  }
  return (['br', 'gzip'] as const).filter(name => (offered.get(name) ?? 0) > 0)
}

const SUFFIX = { br: '.br', gzip: '.gz' } as const

export async function staticFile(request: Request, dist: string, pathname: string): Promise<Response> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  let path = join(dist, relative)
  let file = Bun.file(path)
  const asset = relative.startsWith('/assets/')
  if (asset && !(await file.exists())) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  // Any other path is a page of the app: index.html, whose script reads the route.
  if (relative === '/' || !(await file.exists())) {
    path = join(dist, 'index.html')
    file = Bun.file(path)
    if (!(await file.exists())) return new Response('LilBot web app is not built. Run: bun run build', { status: 503 })
  }

  const headers = new Headers({
    'Content-Type': file.type,
    'Cache-Control': asset ? IMMUTABLE : REVALIDATE,
    ETag: `W/"${file.size.toString(36)}-${file.lastModified.toString(36)}"`,
    Vary: 'Accept-Encoding'
  })
  if (request.headers.get('if-none-match') === headers.get('ETag')) return new Response(null, { status: 304, headers })

  for (const encoding of accepted(request.headers.get('accept-encoding'))) {
    const compressed = Bun.file(path + SUFFIX[encoding])
    if (await compressed.exists()) {
      headers.set('Content-Encoding', encoding)
      return new Response(compressed, { headers })
    }
  }
  return new Response(file, { headers })
}
