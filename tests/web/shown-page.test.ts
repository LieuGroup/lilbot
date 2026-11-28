import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadPage, missingFrom, whyMissing } from '../../shared/client/chat/shown-load'
import type { ShownFile } from '../../shared/shown-schema'
import { PAGE_HEIGHT, PageFrame } from '../../web/src/chat/page-view'
import { missingText } from '../../web/src/chat/shown-item'
import { PAGE_POLICY, PAGE_SANDBOX, pageDocument } from '../../web/src/ui/page-document'

const page: ShownFile = { id: 's1', name: 'chart.html', kind: 'page', mime: 'text/html', size: 38 * 1024, url: '/api/shown/b1/s1', caption: 'Crashes' }
const text = '<h1>Chart</h1><script>document.body.textContent="SCRIPT RAN"</script>'
const attrs = (html: string) => Object.fromEntries([...html.matchAll(/ ([a-zA-Z-]+)="([^"]*)"/g)].map(m => [m[1].toLowerCase(), m[2]]))
const iframeOf = (html: string) => html.match(/<iframe[^>]*>/)?.[0] ?? ''

// The three things the HTML view must never do (#317, the owner's rule). Each test was seen to fail with its guard
// removed; the pull request says how.
test('the frame has no sandbox permission at all: never allow-scripts, never allow-same-origin', () => {
  const frame = attrs(iframeOf(renderToStaticMarkup(createElement(PageFrame, { file: page, text }))))
  expect(PAGE_SANDBOX).toBe('')
  expect(frame.sandbox).toBe('')
  expect(frame.sandbox).not.toMatch(/allow-/)
})

test("the page's own address is never put in a frame: the frame gets its text as srcDoc and has no src", () => {
  const html = renderToStaticMarkup(createElement(PageFrame, { file: page, text }))
  const frame = attrs(iframeOf(html))
  expect(frame.src).toBeUndefined()
  expect(frame.srcdoc).toBeDefined()
  expect(html).not.toContain(page.url)
})

test("nothing in the view or the shared frame opens the page's address in the window", () => {
  for (const path of [
    'web/src/chat/page-view.tsx',
    'web/src/chat/shown-item.tsx',
    'web/src/ui/sandboxed-page.tsx',
    'web/src/ui/page-document.ts',
    'shared/client/chat/shown-load.ts'
  ])
    expect([path, readFileSync(path, 'utf8')]).not.toEqual([
      path,
      expect.stringMatching(/window\.open|location\s*(\.href\s*)?=|location\.(assign|replace)|<a[\s\S]{0,80}href=\{file\.url\}|target="_blank"[\s\S]{0,40}file\.url/)
    ])
  // And the view's markup has no link to it.
  expect(renderToStaticMarkup(createElement(PageFrame, { file: page, text }))).not.toMatch(/href=/)
})

test("the frame's document starts with LilBot's policy and base, before any of the page's text", () => {
  const doc = pageDocument(text)
  expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<h1>'))
  expect(doc).toContain(`content="${PAGE_POLICY}"`)
  expect(doc).toContain('<base target="_blank">')
  expect(PAGE_POLICY).toStartWith("default-src 'none'")
  expect(PAGE_POLICY).not.toMatch(/script-src|connect-src|frame-src|http/)
})

test('the Library preview and the chat view draw the same frame document (one shared module)', () => {
  const preview = readFileSync('web/src/library/page-preview.tsx', 'utf8')
  expect(preview).toContain("from '../ui/sandboxed-page'")
  expect(preview).not.toMatch(/Content-Security-Policy|<iframe/)
  expect(readFileSync('web/src/chat/page-view.tsx', 'utf8')).not.toMatch(/Content-Security-Policy|<iframe/)
})

test('the view keeps the width rule of every item and a fixed height that scrolls inside', () => {
  const html = renderToStaticMarkup(createElement(PageFrame, { file: page, text }))
  expect(html).toContain('max-w-[420px]')
  expect(attrs(iframeOf(html)).style).toBe(`height:${PAGE_HEIGHT}px`)
  expect(html).toContain('Crashes')
  expect(html).toContain('chart.html · HTML · 38 KB')
})

const answer = (status: number, headers: Record<string, string> = {}, body = '') => new Response(status === 204 ? null : body, { status, headers })

test("a page is read as text; a gone or too-large page says why, with the file's size from the route", async () => {
  const get = (status: number, headers?: Record<string, string>) => (async () => answer(status, headers, '<p>hi</p>')) as unknown as typeof fetch
  expect(await loadPage(page.url, get(200))).toEqual({ text: '<p>hi</p>' })
  expect(await loadPage(page.url, get(404))).toEqual({ missing: { kind: 'gone' } })
  expect(await loadPage(page.url, get(413, { 'x-lilbot-file-size': String(3 * 1024 * 1024) }))).toEqual({ missing: { kind: 'too_large', size: 3 * 1024 * 1024 } })
  expect(await loadPage(page.url, (async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toEqual({ missing: { kind: 'gone' } })
  expect(await whyMissing(page.url, get(413))).toEqual({ kind: 'too_large' })
})

test('the fallback lines say the size now when the route gave it (artboard 27, A4)', () => {
  const video = { kind: 'video' as const }
  expect(missingText({ kind: 'too_large', size: 212 * 1024 * 1024 }, video)).toBe('Too large to show here (212 MB, limit 50 MB)')
  expect(missingText({ kind: 'too_large' }, video)).toBe('Too large to show here (limit 50 MB)')
  expect(missingText({ kind: 'too_large', size: 3 * 1024 * 1024 }, page)).toBe('Too large to show here (3 MB, limit 2 MB)')
  expect(missingText({ kind: 'gone' }, page, 'FillLight Bot')).toBe("No longer in FillLight Bot's folder")
  expect(missingFrom(answer(413, { 'x-lilbot-file-size': 'nope' }))).toEqual({ kind: 'too_large' })
})
