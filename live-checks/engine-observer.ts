/** Hermes' own view of a conversation, read over connections of the check's own: which model answered each turn, what
 *  the session reports, what compaction announced. Lets a check prove behaviour LilBot's chat events do not carry. */
import { HermesSocket } from '../server/engines/hermes/hermes-socket'
import { type RestartServer, waitFor } from './restart-server'

export interface Answer {
  model: string
  cache: number | undefined
  context: number
  window: number
  compressions: number
  text: string
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
    answers.push({ model: usage.model, cache: usage.cache_hit_pct, context: usage.context_used, window: usage.context_max, compressions: usage.compressions, text: String(text) })
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
