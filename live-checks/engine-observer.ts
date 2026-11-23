/** Hermes' own view of a conversation, read over connections of the check's own: which model answered each turn, what
 *  the session reports, what compaction announced. Lets a check prove behaviour LilBot's chat events do not carry. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { botCapability } from '../server/bots/bot-capability'
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import { SESSION_HEADER } from '../server/http/engine-run-gate'
import { type RestartServer, waitFor } from './restart-server'

export interface Answer {
  /** Hermes' `message.complete` status: complete, error or interrupted. */
  status: string
  model: string
  cache: number | undefined
  context: number
  window: number
  compressions: number
  text: string
}

/** What Hermes sent the model as the user's turns of these sessions, injected context included (`api_content`: the
 *  memory block rides there, not in the system prompt). Read from the profile's own state file. */
export function sentToModel(native: string, chats: string[]) {
  const state = new Database(join(process.env.HERMES_HOME!, 'profiles', native, 'state.db'), { readonly: true })
  try {
    const rows = state.query(`SELECT content, api_content FROM messages WHERE role = 'user' AND session_id IN (${chats.map(() => '?').join(',')})`).all(...chats) as any[]
    return rows.map(row => String(row.api_content ?? row.content ?? '')).join('\n')
  } finally {
    state.close()
  }
}

/** The session's `info`: model, provider, reasoning_effort, reasoning_effort_wire, context_length. */
export async function engineView(native: string, chatId: string, source = 'gui') {
  const socket = await HermesSocket.connect(
    native,
    () => {},
    () => {}
  )
  try {
    return (await socket.request('session.resume', { session_id: chatId, source, display_projection: true, omit_messages: true })).info
  } finally {
    socket.close()
  }
}

/** Watches one conversation and sends messages to it through LilBot, returning what Hermes reports for each finished turn. */
export async function observeChat(server: RestartServer, native: string, chatId: string) {
  const answers: Answer[] = []
  const statuses: string[] = []
  const socket = await HermesSocket.connect(native, event => {
    if (event.type === 'status.update') statuses.push(String(event.payload.kind))
    if (event.type !== 'message.complete') return
    const { usage = {}, text } = event.payload
    answers.push({
      status: String(event.payload.status ?? ''),
      model: usage.model,
      cache: usage.cache_hit_pct,
      context: usage.context_used,
      window: usage.context_max,
      compressions: usage.compressions,
      text: String(text)
    })
  })
  await socket.request('session.resume', { session_id: chatId, source: 'gui', display_projection: true, omit_messages: true })
  const finished = (from: number) => (server.events.slice(from).some(e => e.chatId === chatId && e.data?.type === 'turn.finished') ? true : null)
  return {
    answers,
    statuses,
    close: () => socket.close(),
    /** Sends a message and resolves with Hermes' report of the turn it started. */
    async turn(text: string): Promise<Answer> {
      const from = server.events.length
      const count = answers.length
      await server.call('chat.send', { chatId, text })
      await waitFor('turn end', async () => finished(from), Boolean, 300_000)
      await waitFor(
        'Hermes turn report',
        async () => answers.length,
        n => n > count,
        10_000
      )
      return answers.at(-1)!
    }
  }
}

/** Confirms `/engine/computers/*` and mutating legacy engine routes refuse a check session while another session passes. */
export async function assertCheckEngineRefusals(port: number, token: string, botId: string, checkChat: string, allowedChat: string) {
  const post = (path: string, body: object, session: string) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-lilbot-bot-capability': botCapability(token, botId), [SESSION_HEADER]: session },
      body: JSON.stringify(body)
    }).then(r => r.status)
  const exec = { computer: 'leader', requestId: 'check-probe', operation: { kind: 'exec', command: 'echo check-probe' } }
  const badBot = { requestId: 'check-bot', name: 'Bad', function: 'x', instructions: 'x' }
  assert.deepEqual(
    await Promise.all([
      post('/engine/computers/list', {}, checkChat),
      post('/engine/computers/submit', exec, checkChat),
      post('/engine/bots/create', badBot, checkChat),
      post('/engine/computers/list', {}, allowedChat)
    ]),
    [422, 422, 422, 200]
  )
}
