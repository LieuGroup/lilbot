import { devScratch } from '../scripts/dev-env'
/** Measure real cold/warm roster reads with isolated, pre-imported temporary bots. */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { BotStore } from '../server/bots/bot-store'
import { openDatabase } from '../server/database/database'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'

const root = devScratch('lilbot-latency')
const engine = new HermesEngine([])
const ids: string[] = []
let server: ReturnType<typeof Bun.spawn> | undefined
let socket: WebSocket | undefined
try {
  for (let i = 0; i < 5; i++) {
    ids.push(
      await engine.createRuntime({
        id: crypto.randomUUID(),
        name: 'Temporary latency check',
        function: '',
        instructions: '',
        model: null,
        isDefault: false,
        permissionMode: 'full-access'
      })
    )
  }
  await Bun.write(join(root, 'profiles.json'), JSON.stringify(ids))
  for (const count of [1, 5]) {
    const data = join(root, String(count))
    const db = openDatabase(join(data, 'lilbot.db'))
    new BotStore(db).import(
      'hermes',
      ids.slice(0, count).map((id, i) => ({
        id: `app-${i}`,
        name: `Temporary ${i}`,
        function: '',
        instructions: '',
        model: null,
        isDefault: false,
        permissionMode: 'full-access' as const,
        engineId: 'hermes',
        engineBotId: id
      }))
    )
    db.close()
    const reservation = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') })
    const port = reservation.port!
    reservation.stop(true)
    server = Bun.spawn(['bun', 'server/main.ts'], {
      env: {
        ...process.env,
        LILBOT_PORT: String(port),
        LILBOT_DATA_DIR: data,
        LILBOT_WORKSPACES_DIR: join(data, 'workspaces'),
        LILBOT_BOT_IDS: ids.slice(0, count).join(','),
        LILBOT_SKIP_MEMORY_SETUP: '1',
        LILBOT_REVIEW: 'off'
      },
      stdout: 'ignore',
      stderr: 'inherit'
    })
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await fetch(`http://127.0.0.1:${port}/api/health`)
          .then(r => r.ok)
          .catch(() => false)
      )
        break
      await Bun.sleep(20)
    }
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    await new Promise<void>((resolve, reject) => {
      socket!.onopen = () => resolve()
      socket!.onerror = reject
    })
    let seq = 0
    const pending = new Map<number, (value: any) => void>()
    socket.onmessage = event => {
      const frame = JSON.parse(String(event.data))
      if (frame.id) {
        pending.get(frame.id)?.(frame)
        pending.delete(frame.id)
      }
    }
    const list = async () => {
      const start = performance.now()
      const frame = await new Promise<any>(resolve => {
        const id = ++seq
        pending.set(id, resolve)
        socket!.send(JSON.stringify({ id, method: 'bots.list', params: {} }))
      })
      if (!frame.ok || frame.result.length !== count) throw new Error('Unexpected roster')
      return { ms: performance.now() - start, pending: frame.result.filter((bot: any) => bot.runtimePending).length }
    }
    const cold = await list()
    const deadline = Date.now() + 90_000
    while ((await list()).pending > 0) {
      if (Date.now() > deadline) throw new Error('Preparation timed out')
      await Bun.sleep(100)
    }
    const warm: number[] = []
    for (let i = 0; i < 5; i++) warm.push((await list()).ms)
    console.log(JSON.stringify({ bots: count, coldMs: cold.ms, coldPending: cold.pending, warmMs: warm }))
    socket.close()
    socket = undefined
    server.kill()
    await server.exited
    server = undefined
  }
} finally {
  socket?.close()
  if (server) {
    server.kill()
    await server.exited
  }
  for (const id of ids) {
    const child = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', 'profile', 'delete', id, '-y'], { env: process.env, stdout: 'ignore', stderr: 'inherit' })
    if ((await child.exited) !== 0) {
      console.error(`Failed to clean temporary profile ${id}`)
      process.exitCode = 1
    }
  }
  rmSync(root, { recursive: true, force: true })
}

process.exit(process.exitCode ?? 0)
