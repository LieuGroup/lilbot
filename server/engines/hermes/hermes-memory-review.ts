import { LilBotError } from '../../../shared/lilbot-error'
import type { ReviewOptions } from '../bot-engine'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { ensureFullAccess } from './hermes-permissions'
import { HermesSocket } from './hermes-socket'
import { reportToolCall } from './hermes-tool-calls'

const CLIENT = { name: 'lilbot', version: '0.2.0' }
const REVIEW_TIMEOUT_MS = 180_000

export async function reviewMemory(botId: string, prompt: string, options: ReviewOptions): Promise<void> {
  const profile = botId === DEFAULT_PROFILE ? '' : botId
  let sessionId: string | undefined
  let finish: (status: unknown) => void = () => {}
  const finished = new Promise<unknown>(resolve => {
    finish = resolve
  })
  const socket = await HermesSocket.connect(
    profile,
    event => {
      reportToolCall(profile, event.sessionId ?? sessionId, event.type, event.payload)
      if (event.type === 'message.complete') finish(event.payload.status)
    },
    () => finish('closed')
  )
  const timer = setTimeout(() => finish('timeout'), REVIEW_TIMEOUT_MS)
  try {
    await ensureFullAccess(socket)
    // Hidden, with LilBot's own System MCP server only (memory recall/save/forget allowed by the session gate).
    const session = await socket.request('session.create', {
      source: 'tool',
      hidden: true,
      toolsets: ['lilbot_system'],
      request_id: crypto.randomUUID(),
      client: CLIENT,
      ...(options.model ? { model: options.model.model, provider: options.model.provider } : {})
    })
    sessionId = session.session_id
    for (const id of new Set([session.session_id, session.stored_session_id])) if (typeof id === 'string') options.onChat(id)
    await socket.request('prompt.submit', { session_id: session.session_id, text: prompt, input_id: crypto.randomUUID() })
    const status = await finished
    if (status !== 'complete') throw new LilBotError('review_failed', `The memory review did not finish (${String(status)}).`)
  } finally {
    clearTimeout(timer)
    socket.close()
  }
}
