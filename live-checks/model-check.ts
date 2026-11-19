import { devScratch } from '../scripts/dev-env'
/** Check model edit refusal and recovery against an isolated server and temporary profile. */
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { BotStore } from '../server/bots/bot-store'
import { openDatabase } from '../server/database/database'

const scratch = devScratch('lilbot-model')
const reservation = Bun.serve({ port: 0, fetch: () => new Response() })
const port = reservation.port!
reservation.stop(true)
const server = Bun.spawn(['bun', 'server/main.ts'], {
  env: {
    ...process.env,
    LILBOT_PORT: String(port),
    LILBOT_DATA_DIR: scratch,
    LILBOT_WORKSPACES_DIR: join(scratch, 'workspaces'),
    LILBOT_SKILLS_DIR: join(scratch, 'skills'),
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
  socket.onmessage = event => {
    const frame = JSON.parse(String(event.data))
    if (frame.id) {
      const waiter = pending.get(frame.id)
      pending.delete(frame.id)
      if (frame.ok) waiter?.resolve(frame.result)
      else waiter?.reject(new Error(frame.error.message))
    }
  }
  const call = (method: string, params = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket!.send(JSON.stringify({ id, method, params }))
    })
  const providers = await call('models.list')
  const provider = providers.find((p: any) => p.models.length)
  if (!provider) throw new Error('No available model')
  const valid = { provider: provider.provider, model: provider.models[0] }
  const bot = await call('bots.create', { name: 'Model check', instructions: 'Temporary test bot.', model: valid })
  const db = openDatabase(join(scratch, 'lilbot.db'))
  const store = new BotStore(db)
  nativeId = store.get(bot.id).engineBotId
  const before = store.get(bot.id)
  const invalid = { provider: valid.provider, model: 'lilbot-nonexistent-model-43' }
  try {
    await call('bots.update', { botId: bot.id, name: 'Must not save', model: invalid })
    throw new Error('Invalid model was accepted')
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('not available')) throw error
  }
  if (JSON.stringify(store.get(bot.id)) !== JSON.stringify(before)) throw new Error('Refused edit changed identity')
  if (!(await call('bots.get', { botId: bot.id })).runnable) throw new Error('Bot became unavailable')
  console.log('PASS: invalid model refused, no identity saved, bot remains available.')
  await call('bots.update', { botId: bot.id, model: valid })
  if (JSON.stringify(store.get(bot.id).model) !== JSON.stringify(valid)) throw new Error('Valid model not saved')
  console.log('PASS: valid model saves.')
  // Reproduce legacy corruption only in the disposable database.
  store.save({ ...store.get(bot.id), model: invalid })
  const recovered = await call('bots.update', { botId: bot.id, model: valid })
  if (!recovered.runnable || JSON.stringify(store.get(bot.id).model) !== JSON.stringify(valid)) throw new Error('Recovery failed')
  console.log('PASS: legacy invalid saved model recovers with a valid replacement.')
  db.close()
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
