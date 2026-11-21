/** Gives a Hermes profile LilBot's MCP connections through Hermes' own MCP server settings. LilBot owns the servers named
 *  `lilbot_*` and nothing else: one it no longer supplies is removed, and any other server in the profile (Oscar's own)
 *  is never changed or removed, even when a name matches. Call only on a socket attached to the intended profile.
 *  The bot's LilBot key goes to the profile's `.env` (Hermes' `bearer_token`); config.yaml keeps only the header template.
 *  After a change, `reload.mcp` connects it for the profile; `applyToChats` commits it to open chats in place. */
import { LilBotError } from '../../../shared/lilbot-error'
import type { ConnectionsApplied, McpConnection } from '../mcp-connection'
import type { HermesSocket } from './hermes-socket'

const OWNED = /^lilbot_/

export function serverConfig(connection: McpConnection) {
  return {
    url: connection.url,
    timeout: connection.timeoutSeconds,
    connect_timeout: 30,
    // LilBot's routes answer POST only; the content-type probe is not needed.
    skip_preflight: true,
    tools: { include: [...connection.tools], resources: false, prompts: false }
  }
}

type Summary = { name?: unknown; url?: unknown; enabled?: unknown; tools?: { include?: unknown } }
type Socket = Pick<HermesSocket, 'request'>
const unavailable = (error: unknown) => error instanceof Error && error.message.includes('mcp servers unavailable')

/** A reload where a configured server did not connect is refused unless something else took effect. Accept it only when
 *  every required connection is connected: a service a bot added may be down without taking the bot down with it. */
async function reload(socket: Socket, required: McpConnection[]) {
  try {
    await socket.request('reload.mcp', { confirm: true })
  } catch (error) {
    if (!unavailable(error)) throw error
    if (!required.length) return
    const status = await socket.request('mcp.servers.status', {})
    if (!required.every(connection => status.servers?.some((row: { name: string; connected: boolean }) => row.name === connection.name && row.connected))) throw error
  }
}

/** Returns whether anything changed. */
export async function prepareConnections(socket: Socket, connections: McpConnection[]): Promise<boolean> {
  const listed = await socket.request('mcp.servers.list', {})
  const servers: Summary[] = Array.isArray(listed.servers) ? listed.servers : []
  const named = (name: string) => servers.find(server => server.name === name)
  const given = connections.filter(connection => OWNED.test(connection.name))
  const stale = given.filter(connection => {
    const existing = named(connection.name)
    const config = serverConfig(connection)
    return !(existing?.url === config.url && existing.enabled !== false && JSON.stringify(existing.tools?.include) === JSON.stringify(config.tools.include))
  })
  const gone = servers.map(server => String(server.name ?? '')).filter(name => OWNED.test(name) && !given.some(connection => connection.name === name))
  if (!stale.length && !gone.length) return false
  // Hermes reconciles running servers by name, so a changed entry is removed and disconnected first, then added and
  // connected: that is what makes it fetch the route's new tool list. Only that server reconnects.
  const replaced = stale.filter(connection => named(connection.name)).map(connection => connection.name)
  for (const name of [...replaced, ...gone]) await socket.request('mcp.servers.remove', { name })
  // Our replaced entries are deliberately absent during this reload; the one below checks the replacements.
  if (replaced.length || gone.length) await reload(socket, [])
  for (const connection of stale) await socket.request('mcp.servers.add', { name: connection.name, config: serverConfig(connection), bearer_token: connection.bearerToken })
  if (stale.length)
    await reload(
      socket,
      given.filter(connection => !connection.optional)
    )
  return true
}

/** `reload.mcp` with a conversation's id commits the profile's servers to that live chat in place (`applied`), or answers
 *  `busy` while its turn runs. A chat that is not live gets no `session`: it reads the config when next resumed. */
async function applyToChats(socket: Socket, chatIds: string[]): Promise<{ chatId: string; state: ConnectionsApplied }[]> {
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
  const using = async <T>(id: string, step: (socket: Pick<HermesSocket, 'request'>) => Promise<T>): Promise<T> => {
    const socket = await open(id)
    try {
      return await step(socket)
    } finally {
      socket.close()
    }
  }
  return {
    prepare: (id: string, connections: McpConnection[]): Promise<void> =>
      turn(id, async () => {
        const key = JSON.stringify(connections)
        if (prepared.get(id) === key) return
        await using(id, socket => prepareConnections(socket, connections))
        prepared.set(id, key)
      }),
    apply: (id: string, chatIds: string[]) => turn(id, () => using(id, socket => applyToChats(socket, chatIds)))
  }
}
