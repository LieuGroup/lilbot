/** What `check:connections` drives: its own dev server with the Access door on local test keys, the bot's conversation,
 *  Oscar's browser on another device, LilBot's own status tool, and the search for tokens outside LilBot's store. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { connectionKey } from '../server/connections/connection-keys'
import { SYSTEM_KEY_PURPOSE } from '../server/system/system-connection'
import { accessEnv, token } from '../tests/http/access-fixture'
import { checkClient } from './check-client'
import { waitFor } from './wait-for'

export async function startCheckServer(env: Record<string, string>, log: string) {
  const child = Bun.spawn(['bun', 'server/main.ts'], { env: { ...process.env, ...env }, stdout: Bun.file(log), stderr: Bun.file(`${log}.err`) })
  await waitFor(
    async () => {
      if (
        await fetch(`http://127.0.0.1:${env.LILBOT_PORT}/api/health`).then(
          r => r.ok,
          () => false
        )
      )
        return true
      if (child.exitCode !== null) throw new Error('The dev server exited before it was ready')
      return false
    },
    Boolean,
    { timeout: 30_000, interval: 100, error: 'The dev server did not start' }
  )
  return child
}

/** One conversation: send a message and wait for the bot's reply; or wait for a turn LilBot started itself. */
export async function conversation(port: number) {
  const finished: { chatId: string; status: string; text: string }[] = []
  const client = await checkClient(port, frame => {
    if (frame.event === 'chat' && frame.data?.type === 'turn.finished') finished.push({ chatId: frame.chatId, status: frame.data.status, text: frame.data.text })
  })
  const [bot] = await client.call('bots.list', {})
  const chat = await client.call('chat.open', { botId: bot.id })
  const next = async (seen: number, label: string, timeout = 240_000) => {
    const turn = await waitFor(() => finished.slice(seen).find(item => item.chatId === chat.chatId), Boolean, { label, timeout, interval: 200 })
    return turn!
  }
  return {
    client,
    botId: bot.id as string,
    chatId: chat.chatId as string,
    turns: () => finished.filter(item => item.chatId === chat.chatId).length,
    say: async (text: string) => {
      const seen = finished.length
      await client.call('chat.send', { chatId: chat.chatId, text, messageId: crypto.randomUUID() })
      const turn = await next(seen, `the reply to: ${text.slice(0, 60)}`)
      if (turn.status !== 'completed') throw new Error(`The turn ended ${turn.status}`)
      console.log(`  bot: ${turn.text.replace(/\s+/g, ' ').slice(0, 160)}`)
      return turn.text
    },
    /** The bot's reply in a turn LilBot gave the conversation after `since` (the "connected" notice). A hidden turn is not
     *  streamed to an open chat, so it is read from the conversation record, which does not resume the session. */
    lilbotReply: async (since: number, not = '') => {
      const reply = await waitFor<any>(
        async () => {
          const page = await client.call('chat.history', { botId: bot.id })
          return page.items.find((row: any) => row.sessionId === chat.chatId && row.at > since && row.item.kind === 'assistant' && row.item.text !== not)
        },
        Boolean,
        { timeout: 180_000, interval: 1000, error: 'Timed out waiting for the turn LilBot gives after a sign-in' }
      )
      console.log(`  bot (LilBot's turn): ${String(reply.item.text).replace(/\s+/g, ' ').slice(0, 160)}`)
      return reply.item.text as string
    }
  }
}

/** `lilbot_status` (area connections) as the bot sees it, through LilBot's own MCP server with the bot's key. */
export async function statusOf(port: number, dataDir: string, botId: string) {
  const key = connectionKey(readFileSync(join(dataDir, 'engine-token'), 'utf8').trim(), SYSTEM_KEY_PURPOSE, botId)
  const response = await fetch(`http://127.0.0.1:${port}/engine/lilbot/mcp`, {
    method: 'POST',
    headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lilbot_status', arguments: { area: 'connections' } } })
  })
  return JSON.parse((await response.json()).result.content[0].text) as { id: string; name: string; state: string; tools: number }[]
}

/** Oscar's browser on another device: the service's sign-in page approves and sends it to LilBot's Access address. */
export async function signInPage(link: string) {
  const response = await fetch(link, { redirect: 'manual' })
  const location = response.headers.get('location')
  if (response.status !== 302 || !location?.startsWith(`https://${accessEnv.LILBOT_ACCESS_HOST}/api/connections/callback?`))
    throw new Error('The sign-in page did not return to LilBot')
  return location
}

/** The browser's request for that address, as Cloudflare hands it to the Access door: with Oscar's Access login, or without. */
export async function openOnAccess(accessPort: number, location: string, login = true) {
  const url = new URL(location)
  const headers: Record<string, string> = { host: accessEnv.LILBOT_ACCESS_HOST, 'sec-fetch-site': 'cross-site' }
  if (login) headers['Cf-Access-Jwt-Assertion'] = token()
  const response = await fetch(`http://127.0.0.1:${accessPort}${url.pathname}${url.search}`, { headers })
  return { status: response.status, text: await response.text() }
}

export const linkIn = (text: string, port: number) => text.match(new RegExp(`http://127\\.0\\.0\\.1:${port}/authorize\\?[^\\s)\\]>"'\`*]+`))?.[0]

/** Every file under `root` holding any of `secrets`, as paths; files named in `except` are LilBot's store. */
export function filesHolding(root: string, secrets: string[], except: string[] = []): string[] {
  if (!existsSync(root)) return []
  const hits: string[] = []
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name)
    if (!entry.isFile() || except.includes(path) || statSync(path).size > 512 << 20) continue
    const text = readFileSync(path).toString('latin1')
    if (secrets.some(secret => text.includes(secret))) hits.push(path)
  }
  return hits
}
