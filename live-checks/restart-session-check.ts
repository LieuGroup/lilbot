import '../scripts/dev-env'
/** #165: deploy-like restarts, a changed tool list and a second device keep the bot's main session, and an empty
 *  session another client opens in the bot's profile draws no divider. Isolated server and temporary bot only. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import type { ChatSnapshot } from '../shared/chat-schema'
import { checkClient } from './check-client'
import { RestartServer, reopenChat, waitFor } from './restart-server'

// Longer than the gateway's grace for a dropped connection (20 s), so the session is no longer held open.
const AWAY_MS = 30_000
const server = await RestartServer.create('lilbot-session-continuity')
const deviceA = crypto.randomUUID()
const deviceB = crypto.randomUUID()

type Call = (method: string, params?: object) => Promise<any>
async function turn(call: Call, events: any[], chatId: string, text: string, deviceId: string) {
  const start = events.length
  await call('chat.send', { chatId, text, messageId: crypto.randomUUID(), deviceId })
  const finished = (frames: any[]) => frames.find(f => f.event === 'chat' && f.chatId === chatId && f.data.type === 'turn.finished')
  const frames = await waitFor(
    'reply',
    async () => events.slice(start),
    frames => !!finished(frames)
  )
  return String(finished(frames).data.text)
}
async function restart(label: string) {
  await server.crash('SIGTERM')
  await Bun.sleep(AWAY_MS)
  await server.start()
  await server.connect()
  console.log(`ok: restarted (${label})`)
}
const open = (call: Call, botId: string) => reopenChat<ChatSnapshot>(() => call('chat.open', { botId }))

try {
  await server.start()
  await server.connect()
  const bot = await server.createBot('Session continuity', 'Answer in one short sentence. Do not use tools.')
  const native = [...server.natives][0]
  const call: Call = (method, params = {}) => server.call(method, params)
  const main = (await open(call, bot.id)).chatId
  await turn(call, server.events, main, 'Remember the word PELICAN for later. Reply OK.', deviceA)

  await restart('as a deploy does, no tool change')
  assert.equal((await open(call, bot.id)).chatId, main, 'A restart moved the conversation to a new session')
  // #194: even when config is unchanged across a >20 s deploy pause, parked LilBot MCP servers must reconnect.
  const check = await HermesSocket.connect(native)
  try {
    const status = await check.request('mcp.servers.status', {})
    for (const name of ['lilbot_system', 'lilbot_t3']) {
      const row = (status.servers as { name: string; connected: boolean; tools: number }[]).find(s => s.name === name)
      assert.ok(row?.connected && row.tools > 0, `MCP server ${name} was not connected after restart: ${JSON.stringify(row)}`)
    }
  } finally {
    check.close()
  }

  // A release with a changed tool list: the profile's LilBot entry no longer matches, so start-up reconnects it.
  const config = join(process.env.HERMES_HOME!, 'profiles', native, 'config.yaml')
  const before = await readFile(config, 'utf8')
  const changed = before.replace(/\n\s+- lilbot_about\n/, '\n')
  assert.notEqual(changed, before, 'The profile has no LilBot tool list to change')
  await writeFile(config, changed)
  await restart('with a changed tool list')
  assert.equal((await open(call, bot.id)).chatId, main, 'A tool reconnect moved the conversation to a new session')
  assert.ok((await readFile(config, 'utf8')).includes('- lilbot_about'), 'Start-up did not reconnect the tools')

  // Another client opens an empty session in the bot's profile while history discovery (every 30 s) runs.
  const foreign = await HermesSocket.connect(native)
  await foreign.request('session.create', { source: 'acp', request_id: crypto.randomUUID(), client: { name: 'continuity-check', version: '1' } })
  await Bun.sleep(40_000)
  foreign.close()

  const phone = await checkClient(server.port, frame => server.events.push(frame), 90_000)
  await phone.call('devices.current', { deviceId: deviceB, name: 'Phone · Check' })
  await phone.call('chat.history', { botId: bot.id })
  assert.equal((await open(phone.call, bot.id)).chatId, main, 'A second device opened a new session')
  await turn(phone.call, server.events, main, 'Reply with just OK.', deviceB)
  phone.socket.close()
  await restart('after the second device')

  const reopened = await open(call, bot.id)
  assert.equal(reopened.chatId, main, 'The first device lost the conversation')
  const answer = await turn(call, server.events, main, 'Which word did I ask you to remember? Answer with the word only.', deviceA)
  assert.match(answer, /pelican/i, 'The bot lost its working context')
  const page = await call('chat.history', { botId: bot.id })
  assert.deepEqual(
    page.items.filter((row: any) => row.item.kind === 'session'),
    [],
    'A divider appeared'
  )
  assert.ok(
    page.items.every((row: any) => row.sessionId === main),
    'Rows from another session appeared'
  )
  console.log('ok: restarts, a tool reconnect, an empty foreign session and a second device keep one session and no divider')
} finally {
  await server.cleanup()
}
