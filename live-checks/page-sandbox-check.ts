import '../scripts/dev-env'
/** Sandbox proof for the HTML view (#317), what a unit test cannot show: in a real browser, the frame exactly as the
 *  web draws it (`sandbox=""`, `srcDoc`, LilBot's head from `page-document.ts`) holding a hostile static page (image,
 *  stylesheet, font, form post, link clicks, meta refresh, nested frames, script tags) sends no request and runs no
 *  script. Real mouse clicks hit two links and a form button that fill the view. A local listener records every
 *  request; Chrome's own network log (frames attached) records what was started and why it was blocked.
 *
 *  Controls draw the same page in a frame with no sandbox and no LilBot head, and must leak, so the listener is shown
 *  able to see each kind of leak: `--control` (with scripts), `--control-clicks` (no scripts, no refresh: a link click
 *  and a form post), `--control-refresh` (no scripts, a 1 s refresh), `--control-self` (one click on each self-navigating
 *  link page, unprotected). Needs Chrome (`LILBOT_CHROME`, default
 *  /usr/bin/google-chrome). No LilBot server, bot or engine is used. */
import { PAGE_SANDBOX, pageDocument } from '../web/src/ui/page-document'
import { openChrome } from './chrome-page'
import { hostileStaticPage, selfNavPages } from './page-hostile'

const mode = process.argv.find(a => a.startsWith('--control')) ?? 'protected'
const control = mode !== 'protected'
const hits: string[] = []
const attacker = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    hits.push(`${request.method} ${new URL(request.url).pathname}`)
    return new Response('evil', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }
})
const scripts = mode === 'protected' || mode === '--control'
const hostile = hostileStaticPage(`http://127.0.0.1:${attacker.port}`, scripts, mode === '--control-clicks' ? 60 : 1)
const doc = control ? hostile : pageDocument(hostile)
const sandbox = control ? '' : ` sandbox="${PAGE_SANDBOX}"`
const parentPage = `<!doctype html><title>LilBot</title><link rel="icon" href="data:,"><body style="margin:0"><p id="marker" style="margin:0;height:18px">untouched</p>
<iframe id="view"${sandbox} referrerpolicy="no-referrer" style="width:420px;height:192px;border:0;display:block"></iframe>
<script>document.getElementById('view').srcdoc = ${JSON.stringify(doc).replace(/</g, '\\u003c')}</script>`
let parentLoaded = false
const lilbotHits: string[] = []
const lilbot = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/' && !parentLoaded) {
      parentLoaded = true
      return new Response(parentPage, { headers: { 'Content-Type': 'text/html' } })
    }
    lilbotHits.push(`${request.method} ${path}`)
    return new Response('lilbot', { status: 404 })
  }
})

/** One page in a fresh browser, drawn as the web draws it (or unprotected for a control), clicked once in the middle.
 *  Returns what the listener saw and what the frame shows afterwards (read in a DevTools world inside the frame). */
async function clickOnce(body: string, protectedFrame: boolean) {
  hits.length = 0
  const frameDoc = protectedFrame ? pageDocument(body) : body
  const frameSandbox = protectedFrame ? ` sandbox="${PAGE_SANDBOX}"` : ''
  const parent = `<!doctype html><title>LilBot</title><link rel="icon" href="data:,"><body style="margin:0"><p id="marker" style="margin:0;height:18px">untouched</p>
<iframe id="view"${frameSandbox} referrerpolicy="no-referrer" style="width:420px;height:192px;border:0;display:block"></iframe>
<script>document.getElementById('view').srcdoc = ${JSON.stringify(frameDoc).replace(/</g, '\\u003c')}</script>`
  let served = false
  const home = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => {
      if (served) return new Response('', { status: 404 })
      served = true
      return new Response(parent, { headers: { 'Content-Type': 'text/html' } })
    }
  })
  const browser = await openChrome()
  try {
    await browser.navigate(`http://127.0.0.1:${home.port}/`)
    await Bun.sleep(800)
    await browser.click(210, 18 + 96)
    await Bun.sleep(1500)
    const frame = await browser
      .evaluateInFrame("(document.getElementById('out')?.textContent ?? '(none)') + ' at ' + location.href")
      .catch(() => '(no frame: the window navigated)')
    return { hits: [...hits], frame: String(frame) }
  } finally {
    await browser.close()
    home.stop(true)
  }
}

const saw = (path: string) => hits.some(h => h.endsWith(path))
let failed = false
const page = await openChrome()
try {
  const home = `http://127.0.0.1:${lilbot.port}/`
  await page.navigate(home)
  await Bun.sleep(mode === '--control-refresh' ? 3000 : 600)
  // The view's text, read in a DevTools world inside the frame (it can read an opaque frame). A control page with
  // scripts navigates the whole window away at once, so there is no frame left to read there.
  const shown = mode === 'protected' ? String(await page.evaluateInFrame("document.getElementById('out')?.textContent ?? '(none)'")) : '(not read)'
  // Real clicks with user activation, left to right: a link to a new window, the form's button, a link to the top window.
  if (mode !== '--control-refresh')
    for (const x of [70, 210, 350]) {
      await page.click(x, 18 + 96)
      await Bun.sleep(700)
    }
  await Bun.sleep(2500)
  const state = JSON.parse(
    await page.evaluate("JSON.stringify({ marker: document.getElementById('marker')?.textContent ?? null, href: location.href })").catch(() => '{"marker":null,"href":"(gone)"}')
  )
  const ran = shown === 'SCRIPT RAN' || hits.some(h => h.includes('/script-'))
  const outside = [...page.requests.values()].filter(r => !/^(data|blob|about):/.test(r.url) && r.url !== home)
  const answered = outside.filter(r => r.answered !== undefined || !r.blocked)
  if (control) {
    let selfNav = true
    if (mode === '--control-self')
      for (const [name, body] of Object.entries(selfNavPages(`http://127.0.0.1:${attacker.port}`))) {
        const seen = await clickOnce(body, false)
        console.log(`CONTROL one click on ${name}: listener ${JSON.stringify(seen.hits)}, the view now shows "${seen.frame}"`)
        selfNav &&= seen.hits.length > 0
      }
    const leaked =
      mode === '--control-self'
        ? selfNav
        : mode === '--control-clicks'
          ? saw('/link-blank') && saw('/form-post')
          : mode === '--control-refresh'
            ? saw('/meta-refresh')
            : hits.length > 0 && ran
    console.log(`CONTROL ${mode}: the listener saw ${hits.length} requests: ${JSON.stringify(hits)}; the window is now at ${state.href}`)
    console.log(leaked ? `CONTROL PASS: unprotected, the same page leaks (${mode}).` : 'CONTROL FAIL: the unprotected page did not leak; the check cannot be trusted.')
    failed = !leaked
  } else {
    const results: [string, boolean, string][] = [
      ['listener: no request from the page', hits.length === 0, JSON.stringify(hits)],
      ['LilBot origin: no request after its page', lilbotHits.length === 0, JSON.stringify(lilbotHits)],
      ["Chrome's network log: every request the page started was blocked before it left", answered.length === 0, JSON.stringify(answered)],
      ['no new window or tab', !page.targets.some(t => t.startsWith('page')), JSON.stringify(page.targets)],
      ['the parent page is untouched and did not navigate', state.marker === 'untouched' && state.href === home, `${state.marker} ${state.href}`],
      ["the page's script did not run: the view still holds its static text", shown === 'STATIC TEXT' && !ran, shown]
    ]
    // One real click per page on a link that navigates the view itself (#336 review). Known gap, see the docs: a frame
    // with no sandbox flags may still navigate itself, and a <meta> policy does not govern navigation. It fails the check.
    for (const [name, body] of Object.entries(selfNavPages(`http://127.0.0.1:${attacker.port}`))) {
      const seen = await clickOnce(body, true)
      results.push([
        `one click on ${name} sends nothing and leaves the view as drawn`,
        seen.hits.length === 0 && seen.frame.startsWith('STATIC TEXT at about:srcdoc'),
        `listener ${JSON.stringify(seen.hits)}, the view now shows "${seen.frame}"`
      ])
    }
    for (const [name, ok, detail] of results) {
      console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : `: ${detail}`}`)
      if (!ok) failed = true
    }
    console.log(`requests the page started, with Chrome's block reason: ${JSON.stringify(outside.map(r => `${new URL(r.url).pathname}=${r.blocked ?? `answered ${r.answered}`}`))}`)
    console.log(`the view's text, read inside the frame: ${shown}`)
  }
  console.log(`browser: ${page.browser}`)
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await page.close()
  attacker.stop(true)
  lilbot.stop(true)
}
if (!control) console.log(failed ? 'FAIL' : 'PASS: the HTML view sent no request and ran no script.')
process.exit(failed ? 1 : 0)
