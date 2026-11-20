/** LilBot's MCP server over the in-memory fake engine: real services, real database, no network. */
import { Workspaces } from '../../server/bots/workspaces'
import type { ComputerService } from '../../server/computers/computer-service'
import { connectionKey } from '../../server/connections/connection-keys'
import { SystemChanges } from '../../server/system/system-changes'
import { SYSTEM_KEY_PURPOSE } from '../../server/system/system-connection'
import { createSystemServer } from '../../server/system/system-server'
import type { T3ConnectionStatus } from '../../shared/connections-schema'
import { fakeService } from '../helpers/fake-engine'

const TOKEN = 'engine-token-for-tests'
const PORT = 3997
const COMMIT = 'abcdef0123456789abcdef0123456789abcdef01'

export function systemFixture() {
  const fake = fakeService()
  const state = { memoryPushes: 0, t3: { state: 'connected', expiresAt: Date.now() + 86_400_000 } as T3ConnectionStatus }
  const changes = new SystemChanges(fake.database)
  const computers = {
    list: () => [
      { id: 'leader', name: 'leader-box', os: 'linux', online: true, lastSeen: 1700000000000, keyConflict: false, main: false },
      { id: 'mac', name: 'MacBook', os: 'darwin', online: false, lastSeen: 1700000000000, keyConflict: false, main: true }
    ]
  } as unknown as ComputerService
  const server = createSystemServer({
    store: fake.store,
    workspaces: new Workspaces(fake.root),
    computers,
    t3: () => state.t3,
    commit: COMMIT,
    bots: fake.service,
    activity: fake.activity,
    memory: fake.memory,
    memoryChanged: () => state.memoryPushes++,
    changes,
    dataDir: fake.root,
    engineToken: TOKEN,
    port: PORT
  })
  const request = (message: unknown, headers: Record<string, string>, method = 'POST') =>
    server.handler(
      new Request(`http://127.0.0.1:${PORT}/engine/lilbot/mcp`, {
        method,
        headers: { host: `127.0.0.1:${PORT}`, ...headers },
        body: method === 'POST' ? JSON.stringify(message) : undefined
      })
    )
  const as = (botId: string) => ({ authorization: `Bearer ${connectionKey(TOKEN, SYSTEM_KEY_PURPOSE, botId)}` })
  const rpc = (botId: string, method: string, params?: unknown, headers: Record<string, string> = {}) =>
    request({ jsonrpc: '2.0', id: 1, method, params }, { ...as(botId), ...headers })
  /** The decoded answer of a tool call: its JSON data, or the refusal text. */
  async function call(botId: string, name: string, args: Record<string, unknown> = {}) {
    const result = (await (await rpc(botId, 'tools/call', { name, arguments: args })).json()).result
    const text: string = result.content[0].text
    return result.isError ? { error: text } : { data: JSON.parse(text) }
  }
  return { ...fake, ...server, state, changes, rosterPushes: fake.changes, request, as, rpc, call }
}

/** A second bot in the roster. */
export async function addBot(f: ReturnType<typeof systemFixture>, name: string) {
  return f.service.createBot({ name, function: `${name} does things`, instructions: '' })
}
