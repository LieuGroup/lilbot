import { homedir } from 'node:os'
import { LilBotError } from '../../../shared/lilbot-error'
import type { ReviewOptions } from '../bot-engine'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { createLimitedSession, denyLimitedApproval } from './hermes-limited-session'
import { ensureFullAccess } from './hermes-permissions'
import { ensureKnownAcpSkillsToolset } from './hermes-skills'
import { HermesSocket } from './hermes-socket'

const REVIEW_TIMEOUT_MS = 180_000

export async function reviewMemory(
  botId: string,
  prompt: string,
  options: ReviewOptions,
  connect = HermesSocket.connect,
  ensureAcpSkills: (id: string) => Promise<void> = ensureKnownAcpSkillsToolset
): Promise<void> {
  if (!options.sessionMcp?.length) {
    throw new LilBotError('session_mcp_unavailable', 'Limited sessions require a session-bound MCP connection.')
  }
  await ensureAcpSkills(botId)
  let finish: (status: unknown) => void = () => {}
  const finished = new Promise<unknown>(resolve => {
    finish = resolve
  })
  let sessionId = ''
  let activeSocket: HermesSocket | undefined
  const socket = await connect(
    botId === DEFAULT_PROFILE ? '' : botId,
    event => {
      if (event.type === 'approval.prompt' && activeSocket && sessionId) {
        denyLimitedApproval(activeSocket, sessionId, event.payload, event.executionGeneration)
      }
      if (event.type === 'message.complete') finish(event.payload.status)
    },
    () => finish('closed')
  )
  activeSocket = socket
  const timer = setTimeout(() => finish('timeout'), REVIEW_TIMEOUT_MS)
  try {
    await ensureFullAccess(socket)
    const session = await createLimitedSession(socket, {
      requestId: crypto.randomUUID(),
      cwd: options.workspace || homedir(),
      access: 'review',
      sessionMcp: options.sessionMcp,
      model: options.model,
      ignoreRules: true,
      assertSessionMcpReady: options.assertSessionMcpReady
    })
    sessionId = typeof session.session_id === 'string' ? session.session_id : ''
    // Persist stored_session_id first so SessionGrants.bindChat records it as canonical primary_chat_id.
    for (const id of new Set([session.stored_session_id, session.session_id])) if (typeof id === 'string') options.onChat(id)
    await socket.request('prompt.submit', { session_id: session.session_id, text: prompt, input_id: crypto.randomUUID() })
    const status = await finished
    if (status !== 'complete') throw new LilBotError('review_failed', `The memory review did not finish (${String(status)}).`)
  } finally {
    clearTimeout(timer)
    socket.close()
  }
}
