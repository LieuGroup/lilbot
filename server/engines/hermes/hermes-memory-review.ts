import { LilBotError } from '../../../shared/lilbot-error'
import type { ReviewOptions } from '../bot-engine'
import { hermesSessionEditor, hermesToolsetsForRun } from './hermes-access'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { ensureFullAccess } from './hermes-permissions'
import { HermesSocket } from './hermes-socket'

const CLIENT = { name: 'lilbot', version: '0.2.0' }
const REVIEW_TIMEOUT_MS = 180_000

export async function reviewMemory(botId: string, prompt: string, options: ReviewOptions): Promise<void> {
  if (!options.mcpConnection) throw new LilBotError('review_failed', 'Memory review connection is missing.')
  const profile = botId === DEFAULT_PROFILE ? '' : botId
  let finish: (status: unknown) => void = () => {}
  const finished = new Promise<unknown>(resolve => {
    finish = resolve
  })
  const socket = await HermesSocket.connect(
    profile,
    event => {
      if (event.type === 'message.complete') finish(event.payload.status)
    },
    () => finish('closed')
  )
  const timer = setTimeout(() => finish('timeout'), REVIEW_TIMEOUT_MS)
  try {
    await ensureFullAccess(socket)
    // Hidden ACP session bound strictly to LilBot's per-pass memory-review MCP connection (`no_mcp` drops
    // lilbot_system and every profile MCP server; `ignore_rules` skips memory hooks and SOUL/AGENTS files).
    const session = await socket.request('session.create', {
      source: 'acp',
      hidden: true,
      yolo: true,
      ignore_rules: true,
      ...(options.workspace ? { cwd: options.workspace, cwd_explicit: true } : {}),
      toolsets: hermesToolsetsForRun('review'),
      request_id: crypto.randomUUID(),
      client: CLIENT,
      editor: hermesSessionEditor(options.mcpConnection),
      ...(options.model ? { model: options.model.model, provider: options.model.provider } : {})
    })
    for (const id of new Set([session.session_id, session.stored_session_id])) if (typeof id === 'string') options.onChat(id)
    await socket.request('prompt.submit', { session_id: session.session_id, text: prompt, input_id: crypto.randomUUID() })
    const status = await finished
    if (status !== 'complete') throw new LilBotError('review_failed', `The memory review did not finish (${String(status)}).`)
  } finally {
    clearTimeout(timer)
    socket.close()
  }
}
