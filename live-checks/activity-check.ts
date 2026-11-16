/** Two browser-protocol clients on an isolated server and temporary profiles. */
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'

const root = mkdtempSync(join(homedir(), 'agent-tmp', 'activity-check-'))
const engine = new HermesEngine()
const ids: string[] = []
let server: ReturnType<typeof Bun.spawn> | undefined
const clients: WebSocket[] = []
const start = async () => {
  server = Bun.spawn(['bun', 'server/main.ts'], {
    env: { ...process.env, LILBOT_PORT: '3371', LILBOT_DATA_DIR: root, LILBOT_WORKSPACES_DIR: join(root, 'workspaces'), LILBOT_BOT_IDS: ids.join(','), LILBOT_REVIEW: 'off' },
    stdout: 'ignore',
    stderr: 'inherit'
  })
  for (let i = 0; i < 100; i++) {
    if (
      await fetch('http://127.0.0.1:3371/api/health')
        .then(r => r.ok)
        .catch(() => false)
    )
      return
    await Bun.sleep(100)
  }
  throw new Error('server did not start')
}
const client = async () => {
  const socket = new WebSocket('ws://127.0.0.1:3371/ws')
  clients.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = reject
  })
  let id = 0
  let pushes = 0
  const pending = new Map<number, { resolve: (value: any) => void; reject: (e: Error) => void }>()
  socket.onmessage = message => {
    const frame = JSON.parse(String(message.data))
    if (frame.event === 'bots.changed') pushes++
    const waiter = pending.get(frame.id)
    if (waiter) {
      pending.delete(frame.id)
      if (frame.ok) waiter.resolve(frame.result)
      else waiter.reject(new Error(frame.error.message))
    }
  }
  return {
    socket,
    pushes: () => pushes,
    call: (method: string, params = {}): Promise<any> =>
      new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
  }
}
const assert = (ok: boolean, label: string) => {
  if (!ok) throw new Error(label)
  console.log(`ok ${label}`)
}
try {
  for (let i = 0; i < 2; i++) ids.push((await engine.createBot({ name: `Activity check ${Date.now()} ${i}`, function: '', instructions: 'Follow the request exactly.' })).id)
  await start()
  const a = await client(),
    b = await client()
  const chat = await a.call('chat.open', { botId: ids[0] })
  await b.call('chat.open', { botId: ids[1] })
  const state = async () => (await b.call('bots.list')).find((bot: any) => bot.id === ids[0]).activity
  await a.call('chat.send', { chatId: chat.chatId, text: 'Use the terminal tool to run sleep 12, then reply with exactly ACTIVITY DONE.' })
  await a.call('chat.close', { chatId: chat.chatId })
  const observed = new Set<string>()
  for (let i = 0; i < 100; i++) {
    const s = await state()
    observed.add(s.status)
    if (s.text === 'Running commands') observed.add('tool')
    if (observed.has('finished') && s.status === 'idle') break
    await Bun.sleep(1000)
  }
  assert(observed.has('working'), 'second browser sees working with no browser viewing the chat')
  assert(observed.has('tool'), 'tool activity says Running commands')
  assert(observed.has('finished') && observed.has('idle'), 'finished settles to idle')
  assert((await state()).unread, 'unviewed reply is unread')
  assert(b.pushes() > 0, 'second browser receives pushes')
  for (const ws of clients) ws.close()
  server!.kill(9)
  await server!.exited
  await start()
  const c = await client()
  const after = () => c.call('bots.list').then(bots => bots.find((bot: any) => bot.id === ids[0]).activity)
  assert((await after()).unread, 'unread survives server restart')
  await c.call('chat.open', { botId: ids[0] })
  assert(!(await after()).unread, 'opening clears unread')
  await c.call('activity.setUnread', { botId: ids[0], unread: true })
  assert((await after()).unread, 'manual unread works')
  const before = JSON.stringify(await after())
  await engine.reviewMemory(ids[0], 'This is a test. Save nothing. Reply OK.', { onChat: () => {} })
  await Bun.sleep(4000)
  assert(JSON.stringify(await after()) === before, 'hidden memory review changes neither activity nor unread')
} finally {
  for (const ws of clients) ws.close()
  server?.kill(9)
  if (server) await server.exited
  for (const id of ids) await Bun.spawn(['hermes', 'profile', 'delete', id, '-y'], { stdout: 'ignore', stderr: 'inherit' }).exited
  rmSync(root, { recursive: true, force: true })
}
// Hermes management sockets stay reusable; the standalone check has no more work.
process.exit(0)
