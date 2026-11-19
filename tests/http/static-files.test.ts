import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { staticFile } from '../../server/http/static-files'

const dist = mkdtempSync(join(tmpdir(), 'lilbot-static-'))
afterAll(() => rmSync(dist, { recursive: true, force: true }))
const script = 'console.log("app")\n'.repeat(200)
mkdirSync(join(dist, 'assets'))
writeFileSync(join(dist, 'index.html'), '<!doctype html><script src="/assets/app-abc.js"></script>')
writeFileSync(join(dist, 'assets', 'app-abc.js'), script)
writeFileSync(join(dist, 'assets', 'app-abc.js.br'), brotliCompressSync(script))
writeFileSync(join(dist, 'assets', 'app-abc.js.gz'), gzipSync(script))
writeFileSync(join(dist, 'icon.png'), 'png')

const get = (path: string, headers: Record<string, string> = {}) => staticFile(new Request(`http://localhost${path}`, { headers }), dist, path)

test('hashed assets are compressed for the browser and kept for a year', async () => {
  const br = await get('/assets/app-abc.js', { 'accept-encoding': 'gzip, deflate, br' })
  expect(br.headers.get('content-encoding')).toBe('br')
  expect(br.headers.get('content-type')).toContain('javascript')
  expect(br.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  expect(br.headers.get('vary')).toBe('Accept-Encoding')
  expect(Buffer.from(await br.arrayBuffer()).equals(brotliCompressSync(script))).toBe(true)
  const gzip = await get('/assets/app-abc.js', { 'accept-encoding': 'gzip, br;q=0' })
  expect(gzip.headers.get('content-encoding')).toBe('gzip')
  const plain = await get('/assets/app-abc.js')
  expect(plain.headers.get('content-encoding')).toBeNull()
  expect(await plain.text()).toBe(script)
})

test('the page and unhashed files are checked again on each visit', async () => {
  const page = await get('/')
  expect(page.headers.get('cache-control')).toBe('no-cache')
  expect(await page.text()).toContain('app-abc.js')
  const etag = page.headers.get('etag')!
  const again = await get('/', { 'if-none-match': etag })
  expect(again.status).toBe(304)
  expect((await get('/icon.png')).headers.get('cache-control')).toBe('no-cache')
})

test('app routes get the page; a missing asset is not answered with the page', async () => {
  const route = await get('/bots/some-bot/memory')
  expect(route.headers.get('content-type')).toContain('text/html')
  expect(route.headers.get('cache-control')).toBe('no-cache')
  const missing = await get('/assets/app-old.js')
  expect(missing.status).toBe(404)
  expect(missing.headers.get('cache-control')).toBe('no-store')
  expect((await get('/../../etc/passwd')).headers.get('content-type')).toContain('text/html')
})
