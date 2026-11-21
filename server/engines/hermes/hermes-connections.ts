/** Gives a Hermes profile LilBot's MCP connections through Hermes' own MCP server settings. Other
 *  servers in the profile are left alone. Call only on a socket attached to the intended profile.
 *  The bot's bridge key goes to the profile's `.env` (Hermes' `bearer_token`); config.yaml keeps
 *  only the header template. After a change, `reload.mcp` reconnects it for this profile's chats. */
import { LilBotError } from '../../../shared/lilbot-error'
import type { McpConnection } from '../bot-engine'
import type { HermesSocket } from './hermes-socket'

export function serverConfig(connection: McpConnection) {
  return {
    url: connection.url,
    timeout: connection.timeoutSeconds,
    connect_timeout: 30,
    // LilBot's bridge answers POST only while signed out; the content-type probe is not needed.
    skip_preflight: true,
    tools: { include: [...connection.tools], resources: false, prompts: false }
  }
}

type Summary = { name?: unknown; url?: unknown; enabled?: unknown; tools?: { include?: unknown } }
type StatusRow = { name?: unknown; connected?: unknown }
type Rpc = Pick<HermesSocket, 'request'>

async function listServers(socket: Rpc): Promise<Summary[]> {
  const listed = await socket.request('mcp.servers.list', {})
  return Array.isArray(listed.servers) ? listed.servers : []
}

async function disconnectedConnections(socket: Rpc, connections: McpConnection[]): Promise<McpConnection[]> {
  if (!connections.length) return []
  const status = await socket.request('mcp.servers.status', {})
  const rows: StatusRow[] = Array.isArray(status.servers) ? status.servers : []
  return connections.filter(connection => !rows.some(row => row.name === connection.name && row.connected === true))
}

async function reloadConnections(socket: Rpc, connections: McpConnection[]) {
  try {
    const result = await socket.request('reload.mcp', { confirm: true })
    const unavailable: unknown[] = Array.isArray(result?.unavailable) ? result.unavailable : []
    if (connections.some(connection => unavailable.includes(connection.name))) {
      throw new LilBotError('hermes_mcp_servers_unavailable', 'Hermes refused the request (mcp servers unavailable).')
    }
  } catch (error) {
    // An inherited optional server can fail reload even when our own bridge connected.
    // Accept only evidence that every requested connection is actually ready.
    if (!(error instanceof Error) || !error.message.includes('mcp servers unavailable')) throw error
    if ((await disconnectedConnections(socket, connections)).length) throw error
  }
}

/** Hermes reconciles running servers by name and keeps parked tasks registered until removed from
 *  config, so drifted or parked entries are removed and reloaded first, then added and reloaded fresh. */
async function replaceConnections(socket: Rpc, connections: McpConnection[], targets: McpConnection[], configured?: Summary[]) {
  const servers = configured ?? (await listServers(socket))
  const present = targets.filter(connection => servers.some(server => server.name === connection.name))
  for (const connection of present) await socket.request('mcp.servers.remove', { name: connection.name })
  if (present.length) {
    try {
      await socket.request('reload.mcp', { confirm: true })
    } catch (error) {
      // Our replaced entries are deliberately absent during this reload. Verify the replacements below.
      if (!(error instanceof Error) || !error.message.includes('mcp servers unavailable')) throw error
    }
  }
  for (const connection of targets) await socket.request('mcp.servers.add', { name: connection.name, config: serverConfig(connection), bearer_token: connection.bearerToken })
  await reloadConnections(socket, connections)
}

/** Reconnects LilBot's own MCP servers if Hermes parked or disconnected them (for example during a LilBot restart). */
export async function reconnectDisconnected(socket: Rpc, connections: McpConnection[]): Promise<boolean> {
  const disconnected = await disconnectedConnections(socket, connections)
  if (!disconnected.length) return false
  await replaceConnections(socket, connections, disconnected)
  return true
}

/** Returns whether anything changed. */
export async function prepareConnections(socket: Rpc, connections: McpConnection[]): Promise<boolean> {
  const servers = await listServers(socket)
  const stale = connections.filter(connection => {
    const existing = servers.find(server => server.name === connection.name)
    const config = serverConfig(connection)
    return !(existing?.url === config.url && existing.enabled !== false && JSON.stringify(existing.tools?.include) === JSON.stringify(config.tools.include))
  })
  const matching = connections.filter(connection => !stale.includes(connection))
  const disconnected = matching.length ? await disconnectedConnections(socket, matching) : []
  const targets = [...stale, ...disconnected]
  if (!targets.length) return false
  await replaceConnections(socket, connections, targets, servers)
  return true
}

/** Prepares each profile once per set of connections, one preparation per profile at a time: two
 *  concurrent adds of the same server would collide. */
export function connectionPreparer(open: (id: string) => Promise<Pick<HermesSocket, 'request' | 'close'>>) {
  const applied = new Map<string, string>()
  const queue = new Map<string, Promise<void>>()
  return (id: string, connections: McpConnection[], statusOnly = false): Promise<void> => {
    const run = (queue.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const key = JSON.stringify(connections)
        if (applied.get(id) === key) return
        const socket = await open(id)
        try {
          await (statusOnly ? reconnectDisconnected(socket, connections) : prepareConnections(socket, connections))
        } finally {
          socket.close()
        }
        applied.set(id, key)
      })
    queue.set(id, run)
    return run
  }
}
