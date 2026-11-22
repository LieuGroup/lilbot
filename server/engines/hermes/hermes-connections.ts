/** Gives a Hermes profile LilBot's MCP connections through Hermes' own MCP server settings. LilBot owns the servers named
 *  `lilbot_*` and nothing else: one it no longer supplies is removed, and any other server in the profile (Oscar's own)
 *  is never changed or removed, even when a name matches. Call only on a socket attached to the intended profile.
 *  The bot's LilBot key goes to the profile's `.env` (Hermes' `bearer_token`); config.yaml keeps only the header template.
 *  After a change, `reload.mcp` connects it for the profile; `applyToChats` commits it to open chats in place. */
import { createHash } from 'node:crypto'
import { LilBotError } from '../../../shared/lilbot-error'
import type { ConnectionsApplied, McpConnection } from '../mcp-connection'
import { applied, hashOf } from './hermes-applied'
import type { HermesSocket } from './hermes-socket'

const OWNED = /^lilbot_/
const MAX_TOOL_NAME = 64
const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_]/g, '_')

/** Hermes' MCP tool name (`tools/mcp_tool_schema.py` `mcp_prefixed_tool_name`): non-word chars become `_`, and names
 *  over 64 chars are clamped with `_` + 8-char SHA-256 hex of the full sanitized name. */
export function hermesMcpToolName(server: string, tool: string): string {
  const full = `mcp__${sanitize(server)}__${sanitize(tool)}`
  if (full.length <= MAX_TOOL_NAME) return full
  const suffix = `_${createHash('sha256').update(full, 'utf8').digest('hex').slice(0, 8)}`
  return `${full.slice(0, MAX_TOOL_NAME - suffix.length)}${suffix}`
}

export function serverConfig(connection: McpConnection) {
  return {
    url: connection.url,
    timeout: connection.timeoutSeconds,
    connect_timeout: 30,
    // LilBot's routes answer POST only; the content-type probe is not needed.
    skip_preflight: true,
    // Outside MCP services must never trigger Hermes server-to-client sampling or elicitation.
    sampling: { enabled: false },
    elicitation: { enabled: false },
    tools: { include: [...connection.tools], resources: false, prompts: false }
  }
}

type Summary = { name?: unknown; url?: unknown; enabled?: unknown; tools?: { include?: unknown } }
type RawServer = { sampling?: { enabled?: unknown }; elicitation?: { enabled?: unknown } }
type StatusRow = { name?: unknown; connected?: unknown }
type Rpc = Pick<HermesSocket, 'request'>
const unavailable = (error: unknown) => error instanceof Error && error.message.includes('mcp servers unavailable')

async function listServers(socket: Rpc): Promise<Summary[]> {
  const listed = await socket.request('mcp.servers.list', {})
  return Array.isArray(listed.servers) ? listed.servers : []
}

async function rawServers(socket: Rpc): Promise<Record<string, RawServer>> {
  const result = await socket.request('config.get', { key: 'full' })
  const servers = (result?.config as { mcp_servers?: unknown } | null | undefined)?.mcp_servers
  return servers && typeof servers === 'object' && !Array.isArray(servers) ? (servers as Record<string, RawServer>) : {}
}

const serverHardened = (raw: RawServer | undefined) => raw?.sampling?.enabled === false && raw?.elicitation?.enabled === false

async function disconnectedConnections(socket: Rpc, connections: McpConnection[]): Promise<McpConnection[]> {
  if (!connections.length) return []
  const status = await socket.request('mcp.servers.status', {})
  const rows: StatusRow[] = Array.isArray(status.servers) ? status.servers : []
  return connections.filter(connection => !rows.some(row => row.name === connection.name && row.connected === true))
}

/** A reload where a configured server did not connect is refused unless something else took effect. Accept it only when
 *  every required connection is connected: a service a bot added may be down without taking the bot down with it. */
async function reloadConnections(socket: Rpc, required: McpConnection[]) {
  try {
    const result = await socket.request('reload.mcp', { confirm: true })
    const failed: unknown[] = Array.isArray(result?.unavailable) ? result.unavailable : []
    if (required.some(connection => failed.includes(connection.name))) {
      throw new LilBotError('hermes_mcp_servers_unavailable', 'Hermes refused the request (mcp servers unavailable).')
    }
  } catch (error) {
    // An inherited or optional server can fail reload even when our required connections are ready.
    if (!unavailable(error)) throw error
    if (required.length && (await disconnectedConnections(socket, required)).length) throw error
  }
}

/** Hermes reconciles running servers by name and keeps parked tasks registered until removed from config, so drifted,
 *  parked or removed entries are removed and reloaded first, then replacements are added and reloaded fresh. */
async function replaceConnections(socket: Rpc, given: McpConnection[], targets: McpConnection[], gone: string[], configured?: Summary[]) {
  const servers = configured ?? (await listServers(socket))
  const present = targets.filter(connection => servers.some(server => server.name === connection.name)).map(connection => connection.name)
  for (const name of [...present, ...gone]) await socket.request('mcp.servers.remove', { name })
  // Replaced entries are deliberately absent during this reload; the one below verifies the replacements.
  if (present.length || gone.length) await reloadConnections(socket, [])
  for (const connection of targets) await socket.request('mcp.servers.add', { name: connection.name, config: serverConfig(connection), bearer_token: connection.bearerToken })
  if (targets.length)
    await reloadConnections(
      socket,
      given.filter(connection => !connection.optional)
    )
}

/** Reconnects LilBot's own MCP servers if Hermes parked or disconnected them (for example during a LilBot restart). */
export async function reconnectDisconnected(socket: Rpc, connections: McpConnection[]): Promise<boolean> {
  const given = connections.filter(connection => OWNED.test(connection.name))
  const disconnected = await disconnectedConnections(socket, given)
  if (!disconnected.length) return false
  await replaceConnections(socket, given, disconnected, [])
  return true
}

/** Returns whether anything changed. */
export async function prepareConnections(socket: Rpc, connections: McpConnection[]): Promise<boolean> {
  const servers = await listServers(socket)
  const given = connections.filter(connection => OWNED.test(connection.name))
  const basicMatch = (connection: McpConnection) => {
    const existing = servers.find(server => server.name === connection.name)
    const config = serverConfig(connection)
    return existing?.url === config.url && existing.enabled !== false && JSON.stringify(existing.tools?.include) === JSON.stringify(config.tools.include)
  }
  const candidates = given.filter(basicMatch)
  const configured = candidates.length ? await rawServers(socket) : {}
  const stale = given.filter(connection => !candidates.includes(connection) || !serverHardened(configured[connection.name]))
  const matching = given.filter(connection => !stale.includes(connection))
  const disconnected = matching.length ? await disconnectedConnections(socket, matching) : []
  const targets = [...stale, ...disconnected]
  const gone = servers.map(server => String(server.name ?? '')).filter(name => OWNED.test(name) && !given.some(connection => connection.name === name))
  if (!targets.length && !gone.length) return false
  await replaceConnections(socket, given, targets, gone, servers)
  return true
}

/** `reload.mcp` with a conversation's id commits the profile's servers to that live chat in place (`applied`), or answers
 *  `busy` while its turn runs. A chat that is not live gets no `session`: it reads the config when next resumed. */
async function applyToChats(socket: Rpc, chatIds: string[]): Promise<{ chatId: string; state: ConnectionsApplied }[]> {
  const results: { chatId: string; state: ConnectionsApplied }[] = []
  for (const chatId of chatIds) {
    let session: unknown
    try {
      session = (await socket.request('reload.mcp', { confirm: true, session_id: chatId })).session
    } catch (error) {
      // A configured server did not connect and nothing changed for this chat; or the chat is gone.
      if (!unavailable(error) && !(error instanceof LilBotError && error.code === 'hermes_not_found')) throw error
      session = 'unchanged'
    }
    results.push({ chatId, state: session === 'applied' || session === 'unchanged' || session === 'busy' ? session : 'not_open' })
  }
  return results
}

/** Prepares each profile once per set of connections and applies to its chats, one step per profile at a time: two
 *  concurrent adds of the same server would collide, and an apply must see the preparation before it. */
export function connectionPreparer(open: (id: string) => Promise<Pick<HermesSocket, 'request' | 'close'>>) {
  const prepared = new Map<string, string>()
  const queue = new Map<string, Promise<unknown>>()
  const turn = <T>(id: string, step: () => Promise<T>): Promise<T> => {
    const run = (queue.get(id) ?? Promise.resolve()).catch(() => {}).then(step)
    queue.set(id, run)
    return run
  }
  const using = async <T>(id: string, step: (socket: Rpc) => Promise<T>): Promise<T> => {
    const socket = await open(id)
    try {
      return await step(socket)
    } finally {
      socket.close()
    }
  }
  return {
    prepare: (id: string, connections: McpConnection[], statusOnly = false): Promise<boolean> =>
      turn(id, async () => {
        const key = JSON.stringify(connections)
        if (prepared.get(id) === key) return false
        const changed = await using(id, socket => (statusOnly ? reconnectDisconnected(socket, connections) : prepareConnections(socket, connections)))
        prepared.set(id, key)
        return changed
      }),
    apply: (id: string, chatIds: string[]) => turn(id, () => using(id, socket => applyToChats(socket, chatIds)))
  }
}

/** Runs `prepare` through `applied()` and returns whether MCP servers actually changed or reconnected (never just
 *  whether `applied()` ran because another setting touched `config.yaml`). */
export async function prepareAppliedConnections(preparer: ReturnType<typeof connectionPreparer>, id: string, connections: McpConnection[], apply = applied): Promise<boolean> {
  let changed = false
  const ran = await apply(id, 'connections', hashOf('v2', connections), async () => {
    changed = await preparer.prepare(id, connections)
  })
  if (!ran) {
    await apply(id, null, '', async () => {
      changed = await preparer.prepare(id, connections, true)
    })
  }
  return changed
}
