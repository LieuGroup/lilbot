import { startServer, deleteProfile } from './check-process'
import { devPort } from '../scripts/dev-paths'
import { devScratch } from '../scripts/dev-paths'
/** Process and socket harness for restart-check and groups-check. Never connects to the live LilBot service. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function waitFor<T>(label: string, read: () => Promise<T>, matches: (value: T) => boolean, timeout = 240_000): Promise<T> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await read()
    if (matches(value)) return value
    await Bun.sleep(250)
  }
  throw new Error(`Restart check timed out: ${label}`)
}

/** Match useChat's bounded reopen attempts after transient engine/startup refusals.
 * Only for opening existing conversations, never sending a prompt or creating work. */
export async function reopenChat<T>(open: () => Promise<T>, timeout = 90_000): Promise<T> {
  const end = Date.now() + timeout
  for (;;) {
    try {
      return await open()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (!/hermes_request_failed|engine_unavailable|engine_timeout|runtime_unavailable/.test(message) || Date.now() >= end) throw error
      await Bun.sleep(3000)
    }
  }
}

export class RestartServer {
  private constructor(
    readonly root: string,
    readonly port: number,
    /** Test-only settings for this server, such as a lower group round limit. */
    private extra: Record<string, string>
  ) {}
  private process?: ReturnType<typeof Bun.spawn>
  private socket?: WebSocket
  private db?: Database
  private seq = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  readonly events: any[] = []
  readonly natives = new Set<string>()
  readonly gates: string[] = []

  static async create(name = 'lilbot-restart', extra: Record<string, string> = {}) {
    const root = devScratch(name)
    const port = devPort()
    assert.notEqual(port, 3370)
    return new RestartServer(root, port, extra)
  }

  async start() {
    this.process = startServer({
      ...process.env,
      ...this.extra,
      LILBOT_HOST: '127.0.0.1',
      LILBOT_PORT: String(this.port),
      LILBOT_PUBLIC_ENABLED: '0',
      LILBOT_DATA_DIR: this.root,
      LILBOT_WORKSPACES_DIR: join(this.root, 'workspaces'),
      LILBOT_SKILLS_DIR: join(this.root, 'skills'),
      LILBOT_BOT_IDS: [...this.natives].join(',') || 'isolation-no-existing-profile',
      LILBOT_SKIP_MEMORY_SETUP: '1',
      LILBOT_REVIEW: 'off'
    })
    await waitFor(
      'server health',
      () =>
        fetch(`http://127.0.0.1:${this.port}/api/health`)
          .then(r => r.ok)
          .catch(() => false),
      Boolean,
      45_000
    )
    this.db ??= new Database(join(this.root, 'lilbot.db'))
    this.db.exec('PRAGMA busy_timeout = 5000')
  }

  async connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${this.port}/ws`)
    this.socket = socket
    socket.onmessage = event => {
      const frame = JSON.parse(String(event.data))
      if (frame.event) return void this.events.push(frame)
      const task = this.pending.get(frame.id)
      this.pending.delete(frame.id)
      frame.ok ? task?.resolve(frame.result) : task?.reject(new Error(JSON.stringify(frame.error)))
    }
    socket.onclose = () => {
      for (const task of this.pending.values()) task.reject(new Error('Test server disconnected'))
      this.pending.clear()
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connect timed out')), 10_000)
      socket.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Socket connect failed'))
      }
    })
  }

  call(method: string, params = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out: ${method}`))
      }, 90_000)
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.socket!.send(JSON.stringify({ id, method, params }))
    })
  }

  async createBot(name: string, instructions: string) {
    try {
      return await this.call('bots.create', { name, function: 'Isolated restart check', instructions })
    } finally {
      this.discoverProfiles()
    }
  }

  private discoverProfiles() {
    for (const row of this.db?.query('SELECT engine_bot_id FROM bots').all() ?? []) this.natives.add((row as { engine_bot_id: string }).engine_bot_id)
  }

  async crash() {
    // Kill only the child we spawned, without giving it a graceful shutdown path.
    this.process?.kill('SIGKILL')
    await this.process?.exited
    this.process = undefined
    this.socket?.close()
    this.socket = undefined
  }

  async cleanup() {
    await this.crash()
    // Release any surviving engine command even if an assertion or model call failed.
    for (const gate of this.gates) await writeFile(gate, 'release').catch(() => {})
    this.discoverProfiles()
    this.db?.close()
    let failed = false
    for (const id of this.natives) {
      const child = deleteProfile(id)
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
      try {
        if (await child.exited) failed = true
      } finally {
        clearTimeout(timer)
      }
    }
    const list = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', 'profile', 'list'], { env: process.env, stdout: 'pipe', stderr: 'inherit' })
    const timer = setTimeout(() => list.kill('SIGKILL'), 30_000)
    let listing: string
    let code: number
    try {
      listing = await new Response(list.stdout).text()
      code = await list.exited
    } finally {
      clearTimeout(timer)
      await rm(this.root, { recursive: true, force: true })
    }
    assert.equal(code, 0, 'Could not confirm temporary profile cleanup')
    for (const id of this.natives) assert.ok(!listing.includes(id), `Temporary profile remains: ${id}`)
    assert.ok(!failed, 'Could not delete a temporary profile')
    console.log('ok: temporary profiles deleted (confirmed with hermes profile list) and folders removed')
  }
}
