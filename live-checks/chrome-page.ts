/** A bare headless Chrome over the DevTools protocol, for checks that must watch every request a page makes: frames,
 *  workers and pop-ups included (auto-attached). No browser library; Chrome itself is the only dependency. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface SeenRequest {
  url: string
  blocked?: string
  answered?: number
}

export async function openChrome(executable = process.env.LILBOT_CHROME ?? '/usr/bin/google-chrome') {
  const profile = mkdtempSync(join(tmpdir(), 'lilbot-chrome-'))
  const args = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']
  const browser = Bun.spawn([executable, ...args], { stdout: 'ignore', stderr: 'ignore' })
  const close = async () => {
    browser.kill()
    await browser.exited
    rmSync(profile, { recursive: true, force: true })
  }
  let port = ''
  for (let i = 0; i < 100 && !port; i++) {
    await Bun.sleep(100)
    try {
      port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]
    } catch {}
  }
  if (!port) {
    await close()
    throw new Error('Chrome did not start')
  }
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string; Browser: string }
  const cdp = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise(resolve => cdp.addEventListener('open', resolve, { once: true }))
  let next = 0
  const waiting = new Map<number, (message: any) => void>()
  const requests = new Map<string, SeenRequest>()
  const targets: string[] = []
  const dialogs: string[] = []
  /** Child frames Chrome runs in their own process (a sandboxed frame is one), each with its own DevTools session. */
  const frames: { sessionId: string; frameId: string }[] = []
  const send = (method: string, params: object = {}, sessionId?: string) =>
    new Promise<any>((resolve, reject) => {
      const id = ++next
      waiting.set(id, message => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)))
      cdp.send(JSON.stringify({ id, method, params, sessionId }))
    })
  cdp.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (message.id) return waiting.get(message.id)?.(message)
    const { method, params } = message
    if (method === 'Network.requestWillBeSent') requests.set(params.requestId, { url: params.request.url })
    const entry = params?.requestId ? requests.get(params.requestId) : undefined
    if (method === 'Network.loadingFailed' && entry) entry.blocked = params.blockedReason ?? params.corsErrorStatus?.corsError ?? params.errorText
    if (method === 'Network.responseReceived' && entry) entry.answered = params.response.status
    if (method === 'Page.javascriptDialogOpening') dialogs.push(params.message)
    if (method === 'Target.targetCreated') targets.push(`${params.targetInfo.type} ${params.targetInfo.url}`)
    if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') frames.push({ sessionId: params.sessionId, frameId: params.targetInfo.targetId })
    if (method === 'Target.attachedToTarget') {
      void send('Network.enable', {}, params.sessionId).catch(() => {})
      void send('Runtime.runIfWaitingForDebugger', {}, params.sessionId).catch(() => {})
    }
  })
  await send('Target.setDiscoverTargets', { discover: true })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  for (const method of ['Network.enable', 'Page.enable']) await send(method, {}, sessionId)
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId)
  targets.length = 0
  const page = {
    browser: version.Browser,
    requests,
    targets,
    dialogs,
    navigate: (url: string) => send('Page.navigate', { url }, sessionId),
    async evaluate(expression: string) {
      const out = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
      if (out.exceptionDetails) throw new Error(`evaluate: ${out.exceptionDetails.exception?.description ?? out.exceptionDetails.text}`)
      return out.result.value
    },
    /** Evaluates in a DevTools isolated world inside the page's first child frame: it runs even where the frame's own
     *  scripts may not, so it can read what a sandboxed frame really shows. */
    async evaluateInFrame(expression: string) {
      const tree = await send('Page.getFrameTree', {}, sessionId)
      const local = tree.frameTree.childFrames?.[0]?.frame.id
      const target = local ? { sessionId, frameId: local } : frames.at(-1)
      if (!target) throw new Error('evaluateInFrame: no child frame')
      if (!local) await send('Page.enable', {}, target.sessionId).catch(() => {})
      const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: target.frameId, worldName: 'lilbot-check' }, target.sessionId)
      const out = await send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true }, target.sessionId)
      if (out.exceptionDetails) throw new Error(`evaluateInFrame: ${out.exceptionDetails.exception?.description ?? out.exceptionDetails.text}`)
      return out.result.value
    },
    /** A real mouse click, with user activation, at page coordinates. */
    async click(x: number, y: number) {
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId)
    },
    async close() {
      cdp.close()
      await close()
    }
  }
  return page
}
