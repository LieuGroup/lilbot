import { devScratch } from '../scripts/dev-env'
/** Real protocol and download check, isolated from the live service and all existing bots. */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'

const scratch = devScratch('lilbot-library-live')
const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') })
const port = reservation.port!
reservation.stop(true)
const engine = new HermesEngine([])
let nativeId = ''
let child: ReturnType<typeof Bun.spawn> | undefined
let socket: WebSocket | undefined
try {
  nativeId = await engine.createRuntime({
    id: crypto.randomUUID(),
    model: null,
    permissionMode: 'full-access',
    isDefault: false,
    name: 'Library live check',
    function: 'Temporary library check',
    instructions: 'Follow the user exactly. Use terminal to create files, then give_file to deliver only what is requested.'
  })
  child = Bun.spawn(['bun', 'server/main.ts'], {
    env: {
      ...process.env,
      LILBOT_PORT: String(port),
      LILBOT_DATA_DIR: scratch,
      LILBOT_SKILLS_DIR: join(scratch, 'skills'),
      LILBOT_WORKSPACES_DIR: join(scratch, 'workspaces'),
      LILBOT_BOT_IDS: nativeId,
      LILBOT_SKIP_MEMORY_SETUP: '1',
      LILBOT_REVIEW: 'off'
    },
    stdout: 'ignore',
    stderr: 'inherit'
  })
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(`http://127.0.0.1:${port}/api/health`)
        .then(r => r.ok)
        .catch(() => false)
    )
      break
    await Bun.sleep(100)
  }
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  await new Promise<void>((resolve, reject) => {
    socket!.onopen = () => resolve()
    socket!.onerror = reject
  })
  let nextId = 0
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  let pushed = false
  let finish: (value: any) => void = () => {}
  socket.onmessage = event => {
    const frame = JSON.parse(String(event.data))
    if (frame.event === 'library.changed') pushed = true
    if (frame.event === 'chat' && frame.data.type === 'turn.finished') finish(frame.data)
    const waiter = pending.get(frame.id)
    if (waiter) {
      pending.delete(frame.id)
      frame.ok ? waiter.resolve(frame.result) : waiter.reject(new Error(frame.error.message))
    }
  }
  const call = (method: string, params: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket!.send(JSON.stringify({ id, method, params }))
    })
  const bots = await call('bots.list', {})
  if (bots.length !== 1) throw new Error('Isolation failed')
  const botId = bots[0].id
  await call('memory.connect', { botId })
  const chat = await call('chat.open', { botId })
  const done = new Promise<any>((resolve, reject) => {
    finish = resolve
    setTimeout(() => reject(new Error('Turn timed out')), 120000).unref()
  })
  await call('chat.send', {
    chatId: chat.chatId,
    text: 'Create delivery.txt in your current workspace containing exactly LIBRARY_LIVE_OK. Also create working.txt containing scratch. Use give_file to give delivery.txt to Oscar with title Library live result. Do not give working.txt. Then stop.'
  })
  const result = await done
  if (result.status !== 'completed') throw new Error(`Turn status ${result.status}`)
  const page = await call('library.list', { botId })
  if (!pushed || page.total !== 1 || page.items[0].title !== 'Library live result' || page.items[0].missing) throw new Error('Library delivery or push failed')
  const { url } = await call('library.content', { botId, itemId: page.items[0].id })
  const response = await fetch(`http://127.0.0.1:${port}${url}`)
  if (!response.ok || !(await response.text()).includes('LIBRARY_LIVE_OK') || !response.headers.get('content-type')?.startsWith('text/plain')) throw new Error('Download failed')
  const entries = await call('library.workspace', { botId })
  if (!entries.some((entry: any) => entry.name === 'working.txt')) throw new Error('Workspace listing failed')
  const denied = await fetch(`http://127.0.0.1:${port}${url}`, { headers: { origin: 'https://evil.example' } })
  if (denied.status !== 403) throw new Error('Cross origin download was accepted')
  console.log('PASS: real bot give_file; library.changed; protocol list, provenance and separate workspace; safe download and cross-origin refusal.')
} finally {
  socket?.close()
  child?.kill()
  if (child) await child.exited
  if (nativeId) {
    const cleanup = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', 'profile', 'delete', nativeId, '-y'], { env: process.env, stdout: 'ignore', stderr: 'inherit' })
    if ((await cleanup.exited) !== 0) {
      console.error(`Cleanup failed for ${nativeId}`)
      process.exitCode = 1
    }
  }
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
