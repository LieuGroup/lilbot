/** What the downloaded helper does when opened: register through the page's hand-over, a `lilbot-helper://` link
 *  or a pasted line (first one wins), then install the service. Opened again later it updates in place. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type HandoverResult, listenForHandover } from './handover-listener'
import { configDir, register } from './identity'
import { service } from './service'
import { type HelperSettings, SHORT_CODE } from './settings'
import type { SetupWindow } from './setup-window'

const ATTEMPT_MS = 10 * 60_000
const identityFile = () => join(configDir, 'identity.json')
const CONNECTED = 'This computer is connected to LilBot. You can close this window.'

/** What `link` touches outside the window; replaced in tests so nothing real is registered or installed. */
export interface LinkPorts {
  registered(): boolean
  register(door: string, code: string): Promise<void>
  install(): Promise<void>
}
const realPorts: LinkPorts = { registered: () => existsSync(identityFile()), register, install: () => service('install') }

async function finish(window: SetupWindow, install: () => Promise<void> = realPorts.install) {
  try {
    await install()
    await window.show(CONNECTED)
  } catch {
    await window.show('This computer is registered, but its background service did not start. Open the LilBot helper again.')
  }
}

export async function setup(settings: HelperSettings, window: SetupWindow) {
  if (existsSync(identityFile())) return finish(window)
  const until = Date.now() + ATTEMPT_MS
  let done = false
  let busy = false
  const attempt = async (code: string): Promise<HandoverResult> => {
    if (busy || done) return { ok: false, error: 'busy' }
    busy = true
    try {
      await register(settings.door, `${code}.${settings.fingerprint}`)
      done = true
      window.close()
      return { ok: true }
    } catch {
      return { ok: false, error: 'refused' }
    } finally {
      busy = false
    }
  }
  let listener: ReturnType<typeof listenForHandover> | undefined
  try {
    listener = listenForHandover(settings, settings.port, until, attempt)
  } catch {
    // Something else holds the port: never hand over through it; the link and the pasted line still work.
  }
  let linked = false
  const watch = setInterval(() => {
    if (!done && !busy && existsSync(identityFile())) {
      linked = done = true
      window.close()
    }
  }, 500)
  let message = 'Keep the LilBot page open: it connects this computer by itself.\n\nIf LilBot shows a line to paste, paste it here.'
  try {
    while (!done && Date.now() < until) {
      const line = await window.ask(message, (until - Date.now()) / 1000)
      if (done || line === null) break
      const result = SHORT_CODE.test(line.trim()) ? await attempt(line.trim()) : ({ ok: false, error: 'refused' } as const)
      if (!result.ok) message = 'LilBot did not accept that line. It may have run out: start again in LilBot and paste the new line.'
    }
  } finally {
    clearInterval(watch)
    // Graceful: the page's hand-over request still gets its answer.
    await listener?.stop()
  }
  // A `link` process registered and finishes the install itself.
  if (done && !linked) await finish(window)
  else if (!done && Date.now() >= until) await window.show('This attempt ran out and nothing was added. Start again in LilBot.')
}

/** `lilbot-helper://register#<code>`: the URL arrives on stdin from the macOS launcher. Any web page or local
 *  program can open such a link, so on a registered computer it changes nothing: only opening the app updates. */
export async function link(settings: HelperSettings, url: string, window: SetupWindow, ports: LinkPorts = realPorts) {
  const code = new URL(url).hash.slice(1)
  if (!SHORT_CODE.test(code)) throw new Error('Not a LilBot helper link.')
  if (ports.registered()) return window.show(CONNECTED)
  await ports.register(settings.door, `${code}.${settings.fingerprint}`)
  await finish(window, ports.install)
}
