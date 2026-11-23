/** Boots LilBot's real control plane (createAppServices + real loopback HTTP MCP/engine routes) on ScriptedEngine. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import type { BotEngine } from '../../server/engines/bot-engine'
import { ScriptedEngine, type ScriptedEngineOptions } from '../../server/engines/scripted/scripted-engine'
import { SYSTEM_PATH } from '../../server/system/system-connection'

/** Hermes live-check parity map for every conformance area. */
export const HERMES_LIVE_PARITY = [
  'check:live',
  'check:history',
  'check:system',
  'check:memory',
  'check:skills',
  'check:attachments',
  'check:routines',
  'check:webhooks',
  'check:delegation',
  'check:worker',
  'check:checks',
  'check:restart'
] as const

/** Reference-counted timer tracker so neither setInterval nor Readiness/service setTimeout leaks past close(). */
const origSetInterval = globalThis.setInterval
const origSetTimeout = globalThis.setTimeout
const origClearTimeout = globalThis.clearTimeout
const activeTrackers = new Set<{ intervals: Set<ReturnType<typeof setInterval>>; timeouts: Set<ReturnType<typeof setTimeout>> }>()

function installTimerHook() {
  if (activeTrackers.size > 0) return
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = origSetInterval(...args)
    for (const t of activeTrackers) t.intervals.add(id)
    return id
  }) as typeof setInterval
  ;(globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
    const id = origSetTimeout(
      (...a: unknown[]) => {
        for (const t of activeTrackers) t.timeouts.delete(id)
        fn(...a)
      },
      ms,
      ...rest
    )
    for (const t of activeTrackers) t.timeouts.add(id)
    return id
  }) as typeof setTimeout
  ;(globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
    if (id !== undefined) for (const t of activeTrackers) t.timeouts.delete(id)
    return origClearTimeout(id)
  }) as typeof clearTimeout
}

function uninstallTimerHookIfIdle() {
  if (activeTrackers.size > 0) return
  globalThis.setInterval = origSetInterval
  globalThis.setTimeout = origSetTimeout
  globalThis.clearTimeout = origClearTimeout
}

export interface ConformanceAppOptions extends ScriptedEngineOptions {
  /** Override the engine (or multi-engine registry once P6 lands). */
  engine?: BotEngine
  /** Override the release commit string passed to createAppServices. */
  commit?: string
  /** Reuse an existing temp directory (for reboot tests); caller owns deletion when supplied. */
  dir?: string
}

export async function startConformanceApp(options: ConformanceAppOptions = {}) {
  const ownsDir = !options.dir
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'lilbot-conformance-'))
  const dataDir = join(dir, 'data')
  const workspacesDir = join(dir, 'workspaces')
  const skillsDir = join(dir, 'skills')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(workspacesDir, { recursive: true })
  mkdirSync(skillsDir, { recursive: true })

  const prevSkills = process.env.LILBOT_SKILLS_DIR
  process.env.LILBOT_SKILLS_DIR = skillsDir

  installTimerHook()
  const tracker = { intervals: new Set<ReturnType<typeof setInterval>>(), timeouts: new Set<ReturnType<typeof setTimeout>>() }
  activeTrackers.add(tracker)

  let services!: ReturnType<typeof createAppServices>
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === SYSTEM_PATH) return services.system.handler(request)
      if (url.pathname.startsWith('/engine/connections/')) return services.mcp.forward(request, url.pathname)
      if (url.pathname.startsWith('/engine/')) return services.engineApi(request, url.pathname)
      return new Response('Not found', { status: 404 })
    }
  })

  const engine = options.engine instanceof ScriptedEngine ? options.engine : new ScriptedEngine(options)
  const runtimeEngine = options.engine ?? engine
  services = createAppServices(runtimeEngine, {
    DATA_DIR: dataDir,
    WORKSPACES_DIR: workspacesDir,
    PORT: server.port!,
    MEMORY_ADAPTER_VERSION: '0.14.0',
    COMMIT: options.commit ?? 'conformance-test',
    HOOK_ORIGIN: 'https://hooks.example.test',
    ACCESS_HOST: undefined,
    publish: () => {},
    botsChanged: () => {}
  })

  const close = () => {
    activeTrackers.delete(tracker)
    uninstallTimerHookIfIdle()
    for (const id of tracker.intervals) clearInterval(id)
    for (const id of tracker.timeouts) origClearTimeout(id)
    server.stop(true)
    services.computers.close()
    services.remoteWorkers.runner.close()
    if (ownsDir) rmSync(dir, { recursive: true, force: true })
    if (prevSkills === undefined) delete process.env.LILBOT_SKILLS_DIR
    else process.env.LILBOT_SKILLS_DIR = prevSkills
  }

  return { engine, services, dir, dataDir, workspacesDir, skillsDir, port: server.port!, close }
}

export async function collectHistory(services: ReturnType<typeof createAppServices>, botId: string, pageSize = 2) {
  const page1 = await services.bots.historyPage(botId, undefined, pageSize)
  const all = [...page1.items]
  let cursor = page1.nextCursor
  while (cursor) {
    const next = await services.bots.historyPage(botId, cursor, pageSize)
    all.push(...next.items)
    cursor = next.nextCursor
  }
  return { page1, all }
}

/** Minimal valid 1x1 PNG bytes for attachment conformance tests. */
export const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00,
  0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
])
