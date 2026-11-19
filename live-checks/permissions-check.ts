import { devScratch } from '../scripts/dev-env'
/** A second, isolated server exercises the public protocol and a harmless approval-triggering command. */
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { BotStore } from '../server/bots/bot-store'
import { openDatabase } from '../server/database/database'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'

const scratch = devScratch('lilbot-permissions')
const port = Number(process.env.LILBOT_CHECK_PORT ?? 3381)
const server = Bun.spawn(['bun', 'server/main.ts'], {
  env: {
    ...process.env,
    LILBOT_PORT: String(port),
    LILBOT_DATA_DIR: scratch,
    LILBOT_WORKSPACES_DIR: join(scratch, 'workspaces'),
    LILBOT_BOT_IDS: 'isolated-no-profiles',
    LILBOT_SKIP_MEMORY_SETUP: '1',
    LILBOT_REVIEW: 'off'
  },
  stdout: 'ignore',
  stderr: 'inherit'
})
let socket: WebSocket | undefined
let nativeId = ''
try {
  for (let attempt = 0; attempt < 100; attempt++) {
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
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  let finish: (event: any) => void = () => {}
  socket.onmessage = event => {
    const frame = JSON.parse(String(event.data))
    if (frame.id) {
      const waiter = pending.get(frame.id)
      pending.delete(frame.id)
      if (frame.ok) waiter?.resolve(frame.result)
      else waiter?.reject(new Error(frame.error.message))
    }
    if (frame.event === 'chat' && frame.data.type === 'turn.finished') finish(frame.data)
  }
  const call = (method: string, params = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket!.send(JSON.stringify({ id, method, params }))
    })
  const bot = await call('bots.create', {
    name: 'Permissions check',
    instructions: 'Follow the user precisely. Use terminal tools when asked.',
    model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
  })
  const db = openDatabase(join(scratch, 'lilbot.db'))
  nativeId = new BotStore(db).get(bot.id).engineBotId
  db.close()
  if (bot.permissionMode !== 'full-access') throw new Error('Wrong default')
  const inspect = await HermesSocket.connect(
    nativeId,
    () => {},
    () => {}
  )
  try {
    if ((await inspect.request('config.get', { key: 'approvals.mode' })).value !== 'off') throw new Error('Profile approvals not off')
    // Deliberate drift on this temporary profile: opening the chat must repair it.
    await inspect.request('config.set', { key: 'approvals.mode', value: 'manual' })
    const chat = await call('chat.open', { botId: bot.id })
    if ((await inspect.request('config.get', { key: 'approvals.mode' })).value !== 'off') throw new Error('Profile drift not repaired')
    const done = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Turn did not finish without approval')), 120_000)
      finish = event => {
        clearTimeout(timer)
        resolve(event)
      }
    })
    await call('chat.send', {
      chatId: chat.chatId,
      text: 'Use the terminal to run exactly: mkdir -p permission-check-trash && printf test > permission-check-trash/file && rm -rf permission-check-trash && printf PASS > permission-check-result.txt . Run only in your current workspace. Then reply PERMISSIONS_OK.'
    })
    const result = await done
    if (result.status !== 'completed' || !existsSync(join(bot.workspace, 'permission-check-result.txt'))) throw new Error('Command did not complete')
    if ((await inspect.request('approval.pending', { session_id: chat.chatId })).approvals.length) throw new Error('Approval left pending')
    console.log('PASS: default full-access, profile drift repaired, recursive delete and file write completed, no pending approvals.')
    await call('chat.close', { chatId: chat.chatId })
  } finally {
    inspect.close()
  }
} finally {
  socket?.close()
  server.kill()
  await server.exited
  // Recover the native id even if creation failed after persisting it.
  if (!nativeId && existsSync(join(scratch, 'lilbot.db'))) {
    const db = openDatabase(join(scratch, 'lilbot.db'))
    nativeId = new BotStore(db).list()[0]?.engineBotId ?? ''
    db.close()
  }
  if (nativeId) {
    const deletion = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', 'profile', 'delete', nativeId, '-y'], { env: process.env, stdout: 'ignore', stderr: 'inherit' })
    if ((await deletion.exited) !== 0) {
      console.error(`Could not delete temporary profile ${nativeId}`)
      process.exitCode = 1
    }
  }
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
