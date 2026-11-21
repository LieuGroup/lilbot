/** The services' backend over a real database and credential file, with a clock the tests move. */
import { afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpConnectionStore } from '../../server/connections/mcp-connection-store'
import { McpConnections } from '../../server/connections/mcp-connections'
import { McpCredentials } from '../../server/connections/mcp-credentials'
import { returnOf, SignInFlows } from '../../server/connections/mcp-sign-in'
import { openDatabase } from '../../server/database/database'

export const REDIRECT = 'https://bot.example.com/api/connections/callback'

export function connectionsFixture(redirectUri: string | null = REDIRECT, callbackEnabled = false) {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-connections-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const database = openDatabase(join(root, 'lilbot.db'))
  const clock = { now: 1_700_000_000_000 }
  const now = () => clock.now
  const store = new McpConnectionStore(database)
  const credentials = new McpCredentials(join(root, 'mcp-credentials.json'))
  const flows = new SignInFlows(undefined, now)
  const signedIn: { botId: string; chatId: string; name: string; runId: string }[] = []
  const bots = new Set(['bot-a', 'bot-b'])
  const chatOf = new Map<string, string>()
  const userMessages: { botId: string; chatId: string; text: string }[] = []
  let changes = 0
  const services = new McpConnections(
    store,
    credentials,
    flows,
    {
      botName: id => (id === 'bot-a' ? 'Alpha' : 'Beta'),
      botExists: id => bots.has(id),
      callingChat: async botId => chatOf.get(botId) ?? `${botId}-main`,
      userSentInChat: (botId, chatId, text) => userMessages.some(msg => msg.botId === botId && msg.chatId === chatId && msg.text.includes(text)),
      signedIn: (botId, chatId, name, runId) => signedIn.push({ botId, chatId, name, runId }),
      changed: () => changes++
    },
    redirectUri ?? undefined,
    now,
    callbackEnabled
  )
  /** What Oscar's browser does with a sign-in link: the service approves and sends it to LilBot's return address. */
  const browse = async (link: string) => {
    const response = await fetch(link, { redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status !== 302 || !location) throw new Error(`The sign-in page answered ${response.status}`)
    return location
  }
  const callback = (location: string) => services.complete(returnOf(location, redirectUri ?? REDIRECT))
  const userSays = (botId: string, text: string, chatId = chatOf.get(botId) ?? `${botId}-main`) => userMessages.push({ botId, chatId, text })
  return { root, database, clock, store, credentials, services, signedIn, bots, chatOf, userSays, browse, callback, changes: () => changes }
}
