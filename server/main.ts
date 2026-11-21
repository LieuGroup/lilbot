import { createAppServices } from './app-services'
import { checkPublicPort, isTunnelRequest, plainServerError } from './http/listener-safety'
/** LilBot server: serves the built web app and answers the browser's `/ws` requests through the bot engine.
 *  Binds to loopback only; reach it from other devices through the tailnet (`tailscale serve`). */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WebSocketHandler } from 'bun'
import { AddThisComputer } from './computers/add-this-computer'
import { HelperDownloads, helperSettings } from './computers/helper-downloads'
import { CALLBACK_PATH } from './connections/mcp-callback'
import { T3_BRIDGE_PATH } from './connections/t3-connection'
import { deployNotice } from './deploy/deploy-notice'
import { runningCommit } from './deploy/health'
import { HermesEngine } from './engines/hermes/hermes-engine'
import { MEMORY_ADAPTER_VERSION } from './engines/hermes/hermes-memory-setup'
import { assertServerEnvironment } from './environment'
import { startAccessDoor } from './http/access-door'
import { accessSettings } from './http/access-settings'
import { appRoutes, type SocketData } from './http/app-routes'
import { BrowserSession } from './http/browser-session'
import { startPublicDoor } from './http/public-door'
import { allowedHosts } from './http/socket-guard'
import { webhookRoute } from './http/webhook-route'
import { files } from './skills/skill-files'
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

const engine = new HermesEngine(process.env.LILBOT_BOT_IDS?.split(',').filter(Boolean))
const { bots, store, skills, hiddenChat, library, computers, devices, attachments, t3Grants, mcp, system, engineApi, activity, routines, threads, boards, webhooks } =
  createAppServices(engine, {
    DATA_DIR,
    WORKSPACES_DIR,
    PORT,
    MEMORY_ADAPTER_VERSION,
    COMMIT,
    // `helperSettings` below refuses a helper URL that is not the door's HTTPS origin.
    HOOK_ORIGIN: PUBLIC_ENABLED && process.env.LILBOT_HELPER_URL ? new URL(process.env.LILBOT_HELPER_URL).origin : undefined,
    ACCESS_HOST: ACCESS?.host,
    publish: frame => publish(EVERYONE, JSON.stringify(frame)),
    botsChanged
  })

// Every bot uses LilBot's memory: bots on an older adapter are updated, and a bot that is not
// connected yet is connected. Both take effect from the bot's next session.
async function prepareMemory() {
  // Temporary test servers must opt in: never rewrite real profiles' memory endpoints.
  await bots.prepareRuntimes()
  if (process.env.LILBOT_SKIP_MEMORY_SETUP === '1') return
  const updated = await engine.refreshMemory(
    store
      .list()
      .filter(bot => bot.engineId === engine.id)
      .map(bot => bot.engineBotId)
  )
  if (updated.length) console.log(`Memory adapter updated to ${MEMORY_ADAPTER_VERSION} for: ${updated.join(', ')}`)
  const connected = await bots.connectAllMemory()
  if (connected.length) console.log(`Connected to LilBot memory: ${connected.join(', ')}`)
}
prepareMemory().catch(error => console.error('[memory] could not prepare memory for the bots:', error instanceof Error ? error.message : error))

engine.onBotsChanged(botsChanged)
bots.watchActivity(event => {
  if (!hiddenChat(event.botId, event.chatId)) activity.observe(event)
}, activity.cursor)
const DIST = join(import.meta.dir, '..', 'dist')
const downloads = new HelperDownloads(join(DATA_DIR, 'helper-downloads'), helperSettings(process.env, PORT, ACCESS?.host, computers.auth.serverKey.fingerprint))
const addThis = new AddThisComputer(computers, downloads)

const ALLOWED_HOSTS = allowedHosts(PORT, process.env.LILBOT_ALLOWED_HOSTS)

const websocket: WebSocketHandler<SocketData> = {
  open(socket) {
    socket.subscribe(EVERYONE)
    socket.data.session = new BrowserSession(
      bots,
      frame => {
        // A send after the browser left is expected and harmless.
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
      },
      activity,
      routines,
      library,
      threads,
      () => ({ t3: t3Grants.status(), services: mcp.services.list() }),
      computers,
      () => deployNotice(DATA_DIR),
      attachments,
      addThis,
      devices,
      boards.work,
      webhooks,
      boards.goals
    )
  },
  message(socket, message) {
    void socket.data.session?.handle(typeof message === 'string' ? message : message.toString())
  },
  close(socket) {
    socket.data.session?.close()
  }
}

const browserRoutes = appRoutes(library, DIST, ALLOWED_HOSTS, 'hermes', attachments, downloads, threads)
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
        server.timeout(request, 0)
        return mcp.t3Bridge(request)
      }
      if (url.pathname.startsWith('/engine/connections/')) {
        // The route bounds each call itself (`mcp-forward.ts`).
        server.timeout(request, 0)
        return mcp.forward(request, url.pathname)
      }
      if (url.pathname === SYSTEM_PATH) {
        // Creating a bot waits for its greeting: no idle timeout.
        server.timeout(request, 0)
        return system.handler(request)
      }
      if (url.pathname.startsWith('/engine/')) return engineApi(request, url.pathname)
      if (url.pathname === '/api/health') return Response.json({ ok: true, engine: 'hermes', commit: COMMIT, pid: process.pid })
      return await browserRoutes(request, server)
    } catch {
      return plainServerError()
    }
  },
  websocket
})
// The sign-in callback is the one route only the Access door has (#187).
const accessServer = ACCESS
  ? startAccessDoor(ACCESS, appRoutes(library, DIST, new Set([ACCESS.host]), 'hermes', attachments, downloads, threads), websocket, { [CALLBACK_PATH]: mcp.callback })
  : undefined

// LilBot's own skills, restored at every start if they differ.
for (const [name, folder] of [
  ['t3-coding', join(import.meta.dir, 'connections', 't3-coding-skill')],
  ['lilbot-work', join(import.meta.dir, 'work', 'work-skill')],
  ['lilbot-check', join(import.meta.dir, 'work', 'check-skill')]
]) {
  try {
    skills.provide(name, files(folder))
  } catch (error) {
    console.error(`[skills] could not install the ${name} skill:`, error instanceof Error ? error.message : error)
  }
}

console.log(`LilBot listening on http://${server.hostname}:${server.port} (engine: Hermes)`)

// Off until the dedicated tunnel is provisioned. Never target the private app port.
if (PUBLIC_ENABLED) startPublicDoor(computers, PUBLIC_PORT, { hooks: webhookRoute(webhooks) })
