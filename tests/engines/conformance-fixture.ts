/** Boots LilBot's real control plane (createAppServices + real loopback HTTP MCP/engine routes) on ScriptedEngine. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
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

export async function startConformanceApp(options: ScriptedEngineOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-conformance-'))
  const dataDir = join(dir, 'data')
  const workspacesDir = join(dir, 'workspaces')
  const skillsDir = join(dir, 'skills')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(workspacesDir, { recursive: true })
  mkdirSync(skillsDir, { recursive: true })

  const prevSkills = process.env.LILBOT_SKILLS_DIR
  process.env.LILBOT_SKILLS_DIR = skillsDir

  const intervals: ReturnType<typeof setInterval>[] = []
  const origSetInterval = globalThis.setInterval
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = origSetInterval(...args)
    intervals.push(id)
    return id
  }) as typeof setInterval

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

  const engine = new ScriptedEngine(options)
  try {
    services = createAppServices(engine, {
      DATA_DIR: dataDir,
      WORKSPACES_DIR: workspacesDir,
      PORT: server.port!,
      MEMORY_ADAPTER_VERSION: '0.14.0',
      COMMIT: 'conformance-test',
      HOOK_ORIGIN: 'https://hooks.example.test',
      ACCESS_HOST: undefined,
      publish: () => {},
      botsChanged: () => {}
    })
  } finally {
    globalThis.setInterval = origSetInterval
  }

  const close = () => {
    for (const id of intervals) clearInterval(id)
    server.stop(true)
    services.computers.close()
    services.remoteWorkers.runner.close()
    rmSync(dir, { recursive: true, force: true })
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
