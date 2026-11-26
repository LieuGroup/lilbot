import { expect, test } from 'bun:test'
import { rm, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { shownRoute } from '../../server/http/shown-route'
import { parseRange } from '../../server/shown/shown-range'
import { SHOW_LIMITS } from '../../shared/shown-schema'
import { systemFixture } from '../system/system-fixture'

const HOST = '127.0.0.1:3370'
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))

async function shownVideo() {
  const f = systemFixture({ show: true })
  await f.workspaces.ensure('b1')
  await writeFile(join(f.workspaces.pathFor('b1'), 'clip.mp4'), BYTES)
  const { data } = await f.call('b1', 'lilbot_show', { path: 'clip.mp4', requestId: 'r1' })
  const get = (headers: Record<string, string> = {}, path = `/api/shown/b1/${data.id}`, method = 'GET') =>
    shownRoute(new Request(`http://${HOST}${path}`, { method, headers: { host: HOST, ...headers } }), new Set([HOST]), f.showService)
  return { f, id: data.id as string, get }
}

test('the whole file with Accept-Ranges and the download headers, from the saved path', async () => {
  const { get } = await shownVideo()
  const res = await get()
  expect(res.status).toBe(200)
  expect(res.headers.get('accept-ranges')).toBe('bytes')
  expect(res.headers.get('content-type')).toBe('video/mp4')
  expect(res.headers.get('content-length')).toBe('1000')
  expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
  expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  expect(Buffer.from(await res.arrayBuffer()).equals(BYTES)).toBe(true)
})

test('a byte range answers 206 with only those bytes, so a video seeks without loading the whole file', async () => {
  const { get } = await shownVideo()
  for (const [range, start, end] of [
    ['bytes=0-9', 0, 9],
    ['bytes=500-', 500, 999],
    ['bytes=-100', 900, 999],
    ['bytes=990-5000', 990, 999]
  ] as const) {
    const res = await get({ range })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/1000`)
    expect(res.headers.get('content-length')).toBe(String(end - start + 1))
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES.subarray(start, end + 1))).toBe(true)
  }
  const past = await get({ range: 'bytes=1000-' })
  expect([past.status, past.headers.get('content-range')]).toEqual([416, 'bytes */1000'])
  expect((await get({ range: 'bytes=0-1,5-9' })).status).toBe(200)
  expect((await get({ range: 'items=0-9' })).status).toBe(200)
  const head = await get({ range: 'bytes=0-9' }, undefined, 'HEAD')
  expect([head.status, head.headers.get('content-length'), await head.text()]).toEqual([206, '10', ''])
})

test('a file gone from the folder, grown past its limit, or another bot or item is not served; nor a cross-site or foreign-host request', async () => {
  const { f, id, get } = await shownVideo()
  expect((await get({ 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  const foreign = await shownRoute(new Request(`http://evil.example/api/shown/b1/${id}`, { headers: { host: 'evil.example' } }), new Set([HOST]), f.showService)
  expect(foreign.status).toBe(403)
  expect((await get({}, `/api/shown/other/${id}`)).status).toBe(404)
  expect((await get({}, '/api/shown/b1/nope')).status).toBe(404)
  expect((await get({}, `/api/shown/b1/${id}`, 'POST')).status).toBe(405)
  await truncate(join(f.workspaces.pathFor('b1'), 'clip.mp4'), SHOW_LIMITS.bytes.video + 1)
  expect((await get()).status).toBe(413)
  await rm(join(f.workspaces.pathFor('b1'), 'clip.mp4'))
  expect((await get()).status).toBe(404)
})

test('a read that fails mid-stream closes the file and errors the response instead of leaking the handle', async () => {
  let closed = 0
  let reads = 0
  const handle = {
    read: async (buffer: Buffer, offset: number, length: number) => {
      if (reads++ > 0) throw new Error('EIO')
      buffer.fill(7, offset, offset + length)
      return { bytesRead: length, buffer }
    },
    close: async () => {
      closed++
    }
  }
  const shown = { content: async () => ({ handle, size: 600 * 1024, mime: 'video/mp4', name: 'clip.mp4' }) } as never
  const res = await shownRoute(new Request(`http://${HOST}/api/shown/b1/x`, { headers: { host: HOST } }), new Set([HOST]), shown)
  expect(res.status).toBe(200)
  await expect(res.arrayBuffer()).rejects.toThrow('EIO')
  await Bun.sleep(10)
  expect(closed).toBe(1)
})

test('parseRange reads one bytes range and ignores anything it cannot serve', () => {
  expect(parseRange(null, 10)).toBeNull()
  expect(parseRange('bytes=-', 10)).toBeNull()
  expect(parseRange('bytes=5-2', 10)).toBeNull()
  expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable')
  expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable')
  expect(parseRange('bytes=2-4', 10)).toEqual({ start: 2, end: 4 })
})
