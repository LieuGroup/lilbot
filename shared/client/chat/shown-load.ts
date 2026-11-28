/** Loading a shown file's text for the HTML view, and what a failed load means (#317). Pure apart from `fetch`, so it is
 *  tested without a browser. The page is read as text and drawn with `srcDoc`; the route's own address is never framed or
 *  opened. The route answers 404 for a file that is gone and 413 for one past its kind's limit, with its size now in
 *  `X-LilBot-File-Size` (artboard 27, A4: "212 MB, limit 50 MB"). */

export type Missing = { kind: 'gone' } | { kind: 'too_large'; size?: number }

const sizeOf = (response: Response) => {
  const size = Number(response.headers.get('x-lilbot-file-size'))
  return Number.isFinite(size) && size > 0 ? size : undefined
}

/** What the route's answer means when a file did not draw. Anything but 413 is "gone", as before. */
export const missingFrom = (response: Pick<Response, 'status' | 'headers'>): Missing =>
  response.status === 413 ? { kind: 'too_large', ...(sizeOf(response as Response) ? { size: sizeOf(response as Response) } : {}) } : { kind: 'gone' }

/** Why an image or video did not load, from a HEAD for the same address. A failed request counts as gone. */
export const whyMissing = (url: string, get: typeof fetch = fetch): Promise<Missing> =>
  get(url, { method: 'HEAD', cache: 'no-store' }).then(missingFrom, () => ({ kind: 'gone' }) as const)

/** A page's text, or why it cannot be drawn. */
export async function loadPage(url: string, get: typeof fetch = fetch): Promise<{ text: string } | { missing: Missing }> {
  const response = await get(url, { cache: 'no-store' }).catch(() => null)
  if (!response) return { missing: { kind: 'gone' } }
  if (!response.ok) return { missing: missingFrom(response) }
  return { text: await response.text() }
}
