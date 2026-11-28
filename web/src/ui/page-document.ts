/** A page a bot wrote, drawn where it cannot run code or reach the network from the owner's screen (Library preview and
 *  the chat's HTML view, #317). Its text is fetched and put into a frame as `srcDoc`, never framed or opened from its own
 *  address. The frame has no sandbox permissions at all, so no scripts, forms, pop-ups, top navigation or same origin.
 *  This policy, first in its head, refuses every request but inline styles and embedded (data:) images and fonts. The
 *  first <base> sends links to a new window, which the frame may not open. */

/** No sandbox flags: never `allow-scripts`, never `allow-same-origin`, never both. */
export const PAGE_SANDBOX = ''
export const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"
const HEAD = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}"><base target="_blank"><style>body{margin:20px;font:15px/1.55 Inter,system-ui,sans-serif;color:#1b1c1f;background:#fff}</style>`

/** The frame's whole document: LilBot's head, then the page's text. */
export const pageDocument = (text: string) => HEAD + text
