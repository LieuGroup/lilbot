/** Gives a Hermes profile LilBot's MCP connections through Hermes' own MCP server settings. Other
 *  servers in the profile are left alone. Call only on a socket attached to the intended profile.
 *  The bot's bridge key goes to the profile's `.env` (Hermes' `bearer_token`); config.yaml keeps
 *  only the header template. After a change, `reload.mcp` reconnects it for this profile's chats. */
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

/** Returns whether anything changed. */
export async function prepareConnections(socket: Pick<HermesSocket, 'request'>, connections: McpConnection[]): Promise<boolean> {
  const listed = await socket.request('mcp.servers.list', {})
  const servers: Summary[] = Array.isArray(listed.servers) ? listed.servers : []
  const stale = connections.filter(connection => {
    const existing = servers.find(server => server.name === connection.name)
    const config = serverConfig(connection)
    return !(existing?.url === config.url && existing.enabled !== false && JSON.stringify(existing.tools?.include) === JSON.stringify(config.tools.include))
  })
  if (!stale.length) return false
  // Hermes reconciles running servers by name, so a changed entry is removed and disconnected first,
  // then added and connected: that is what makes it fetch the bridge's new tool list.
  const present = stale.filter(connection => servers.some(server => server.name === connection.name))
  for (const connection of present) await socket.request('mcp.servers.remove', { name: connection.name })
  if (present.length) await socket.request('reload.mcp', { confirm: true })
  for (const connection of stale) await socket.request('mcp.servers.add', { name: connection.name, config: serverConfig(connection), bearer_token: connection.bearerToken })
  await socket.request('reload.mcp', { confirm: true })
  return true
}

/** Prepares each profile once per set of connections, one preparation per profile at a time: two
 *  concurrent adds of the same server would collide. */
export function connectionPreparer(open: (id: string) => Promise<Pick<HermesSocket, 'request' | 'close'>>) {
  const applied = new Map<string, string>()
  const queue = new Map<string, Promise<void>>()
  return (id: string, connections: McpConnection[]): Promise<void> => {
    const run = (queue.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const key = JSON.stringify(connections)
        if (applied.get(id) === key) return
        const socket = await open(id)
        try {
          await prepareConnections(socket, connections)
        } finally {
          socket.close()
        }
        applied.set(id, key)
      })
    queue.set(id, run)
    return run
  }
}
