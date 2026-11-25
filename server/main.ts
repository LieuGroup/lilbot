import { startMemoryPreparation } from './app-memory'
import { createAppServices } from './app-services'
import { checkPublicPort, isTunnelRequest, plainServerError } from './http/listener-safety'
/** LilBot server: serves the built web app and answers the browser's `/ws` requests through the bot engine.
 *  Binds to loopback only; reach it from other devices through the tailnet (`tailscale serve`). */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { AddThisComputer } from './computers/add-this-computer'
import { HelperDownloads, helperSettings, privateDownloadOrigin } from './computers/helper-downloads'
import { CALLBACK_PATH } from './connections/mcp-callback'
import { isT3Enabled, T3_BRIDGE_PATH } from './connections/t3-connection'
import { deployNotice } from './deploy/deploy-notice'
import { runningCommit } from './deploy/health'
import { createDefaultEngines } from './engines/registry'
import { assertServerEnvironment } from './environment'
import { startAccessDoor } from './http/access-door'
import { accessSettings } from './http/access-settings'
import { appRoutes, type SocketData } from './http/app-routes'
import { BrowserSession } from './http/browser-session'
import { createBrowserWebSocket } from './http/browser-ws'
import { startPublicDoor } from './http/public-door'
import { allowedHosts } from './http/socket-guard'
import { webhookRoute } from './http/webhook-route'
import { files } from './skills/skill-files'
import { SESSION_MCP_PREFIX } from './system/session-grants'
import { SYSTEM_PATH } from './system/system-connection'

assertServerEnvironment(process.env)
const COMMIT = runningCommit(join(import.meta.dir, '..'))
const PORT = Number(process.env.LILBOT_PORT ?? 3370)
const PUBLIC_PORT = Number(process.env.LILBOT_PUBLIC_PORT ?? 3372)
const PUBLIC_ENABLED = process.env.LILBOT_PUBLIC_ENABLED === '1'
if (PUBLIC_ENABLED) checkPublicPort(PUBLIC_PORT, PORT)
const ACCESS = accessSettings(process.env, PORT, PUBLIC_PORT)
const HOST = process.env.LILBOT_HOST ?? '127.0.0.1'
/** LilBot's own database file lives here. */
const DATA_DIR = process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local', 'share', 'lilbot')
/** Each bot's workspace folder is created under here. */
const WORKSPACES_DIR = process.env.LILBOT_WORKSPACES_DIR ?? join(homedir(), 'lilbot', 'workspaces')
/** Every connected browser is subscribed to this topic. */
const EVERYONE = 'everyone'
const CHANGE_DELAY_MS = 300
const publish = (topic: string, data: string) => {
  server.publish(topic, data)
  accessServer?.publish(topic, data)
}

// Several changes in a row (or a burst of engine events) become one "fetch the bot list again".
let changeTimer: ReturnType<typeof setTimeout> | undefined
function botsChanged() {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(() => publish(EVERYONE, JSON.stringify({ event: 'bots.changed' })), CHANGE_DELAY_MS)
}

const T3_ENABLED = isT3Enabled(process.env)
const engines = createDefaultEngines(process.env)
const MEMORY_ADAPTER_VERSION = engines.defaultEngine.memoryAdapterVersion ?? 'none'
const services = createAppServices(engines, {
  DATA_DIR,
  WORKSPACES_DIR,
  PORT,
  MEMORY_ADAPTER_VERSION,
  COMMIT,
  // `helperSettings` below refuses a helper URL that is not the door's HTTPS origin.
  HOOK_ORIGIN: PUBLIC_ENABLED && process.env.LILBOT_HELPER_URL ? new URL(process.env.LILBOT_HELPER_URL).origin : undefined,
  ACCESS_HOST: ACCESS?.host,
  ACCESS_CALLBACK_ENABLED: ACCESS?.callbackEnabled ?? false,
  T3_ENABLED,
  publish: frame => publish(EVERYONE, JSON.stringify(frame)),
  botsChanged
})
const { bots, store, library, computers, attachments, t3Grants, mcp, system, engineApi, activity, routines, threads, boards, webhooks } = services

async function prepareMemory(onFailed: (id: string) => void) {
  await bots.prepareRuntimes()
  if (process.env.LILBOT_SKIP_MEMORY_SETUP === '1') return
  const updated = await engines.refreshMemory(engineId => store.list().filter(bot => bot.engineId === engineId), services.memoryConnection, onFailed)
  if (updated.length) console.log(`Memory adapter updated to ${MEMORY_ADAPTER_VERSION} for: ${updated.join(', ')}`)
  const connected = await bots.connectAllMemory(onFailed)
  if (connected.length) console.log(`Connected to LilBot memory: ${connected.join(', ')}`)
}

engines.onBotsChanged(botsChanged)
bots.watchActivity(event => {
  if (!services.hiddenChat(event.botId, event.chatId)) activity.observe(event)
}, activity.cursor)
const DIST = join(import.meta.dir, '..', 'dist')
const helperCfg = helperSettings(process.env, PORT, ACCESS?.host, computers.auth.serverKey.fingerprint)
const downloads = new HelperDownloads(join(DATA_DIR, 'helper-downloads'), helperCfg, privateDownloadOrigin(process.env, PORT))
const addThis = new AddThisComputer(computers, downloads)

const ALLOWED_HOSTS = allowedHosts(PORT, process.env.LILBOT_ALLOWED_HOSTS)

const { websocket } = createBrowserWebSocket({
  topic: EVERYONE,
  createSession: socket =>
    new BrowserSession(
      bots,
      frame => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
      },
      activity,
      routines,
      library,
      threads,
      mcp.browser(() => t3Grants.status()),
      computers,
      () => deployNotice(DATA_DIR),
      attachments,
      addThis,
      services.devices,
      boards.work,
      webhooks,
      boards.goals,
      services.notifications,
      services.checkpointChoices
    )
})

const browserRoutes = appRoutes(library, DIST, ALLOWED_HOSTS, engines.defaultId, attachments, downloads, threads)
const server = Bun.serve<SocketData>({
  development: false,
  error: plainServerError,
  port: PORT,
  hostname: HOST,
  async fetch(request, server) {
    try {
      if (isTunnelRequest(request)) return new Response('Forbidden', { status: 403 })
      const url = new URL(request.url)
      if (url.pathname === T3_BRIDGE_PATH) {
        if (!T3_ENABLED) return new Response('Not found', { status: 404 })
        server.timeout(request, 0)
        return mcp.t3Bridge(request)
      }
      if (url.pathname.startsWith('/engine/connections/')) {
        // The route bounds each call itself (`mcp-forward.ts`).
        server.timeout(request, 0)
        return mcp.forward(request, url.pathname)
      }
      if (url.pathname === SYSTEM_PATH || (system.scoped && url.pathname.startsWith(SESSION_MCP_PREFIX))) {
        server.timeout(request, 0)
        return url.pathname === SYSTEM_PATH ? system.handler(request) : system.scoped!(request, url.pathname)
      }
      if (url.pathname.startsWith('/engine/')) return engineApi(request, url.pathname)
      if (url.pathname === '/api/health') return Response.json({ ok: true, engine: engines.defaultId, engines: engines.ids(), commit: COMMIT, pid: process.pid })
      return await browserRoutes(request, server)
    } catch {
      return plainServerError()
    }
  },
  websocket
})
// The sign-in callback is mounted on the Access door only when opted in (`LILBOT_ACCESS_CALLBACK_ENABLED=1`).
const accessServer = ACCESS
  ? startAccessDoor(
      ACCESS,
      appRoutes(library, DIST, new Set([ACCESS.host]), engines.defaultId, attachments, downloads, threads),
      websocket,
      ACCESS.callbackEnabled ? { [CALLBACK_PATH]: mcp.callback } : {}
    )
  : undefined

// LilBot's own skills, restored at every start if they differ; inactive coding skill is removed.
for (const [name, folder] of [
  T3_ENABLED ? ['t3-coding', join(import.meta.dir, 'connections', 't3-coding-skill')] : ['lilbot-coding', join(import.meta.dir, 'threads', 'coding-skill')],
  ['lilbot-work', join(import.meta.dir, 'work', 'work-skill')],
  ['lilbot-check', join(import.meta.dir, 'work', 'check-skill')]
]) {
  try {
    services.skills.provide(name, files(folder))
  } catch (error) {
    console.error(`[skills] could not install the ${name} skill:`, error instanceof Error ? error.message : error)
  }
}
try {
  mcp.onCodingSkillsReady(services.skills.remove(T3_ENABLED ? 'lilbot-coding' : 't3-coding'))
} catch (error) {
  console.error('[skills] could not remove inactive coding skill:', error instanceof Error ? error.message : error)
  mcp.onCodingSkillsReady(false)
}
startMemoryPreparation(prepareMemory)
bots.resumeIncompleteDeletions()

console.log(`LilBot listening on http://${server.hostname}:${server.port} (engines: ${engines.ids().join(', ')})`)

// Off until the dedicated tunnel is provisioned. Never target the private app port.
if (PUBLIC_ENABLED) startPublicDoor(computers, PUBLIC_PORT, { hooks: webhookRoute(webhooks), workers: services.remoteWorkers.runner.bridge })
