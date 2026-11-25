import { homedir } from 'node:os'
import { LilBotError } from '../../../shared/lilbot-error'
import type { ReviewOptions } from '../bot-engine'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { createLimitedSession, denyLimitedApproval } from './hermes-limited-session'
import { ensureFullAccess } from './hermes-permissions'
import { ensureKnownAcpSkillsToolset } from './hermes-skills'
import { HermesSocket } from './hermes-socket'

const REVIEW_TIMEOUT_MS = 180_000
/** Content-refusal code declared on Hermes' `message.complete` (`error_surface.code` / `failure_reason`).
 *  `provider_policy_blocked` is an aggregator account data/privacy configuration error, not a content refusal. */
const CONTENT_REFUSAL_CODE = 'content_policy_blocked'
const PROVIDER_POLICY_CODE = 'provider_policy_blocked'

type ReviewOutcome = { status: unknown; failureCode?: string }

function failureCodeFrom(payload: Record<string, unknown>): string | undefined {
  const surface = payload.error_surface
  if (surface && typeof surface === 'object' && typeof (surface as { code?: unknown }).code === 'string' && (surface as { code: string }).code) {
    return (surface as { code: string }).code
  }
  return typeof payload.failure_reason === 'string' && payload.failure_reason ? payload.failure_reason : undefined
}

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
  let finish: (outcome: ReviewOutcome) => void = () => {}
  const finished = new Promise<ReviewOutcome>(resolve => {
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
      if (event.type === 'message.complete') {
        finish({ status: event.payload.status, failureCode: failureCodeFrom(event.payload as Record<string, unknown>) })
      }
    },
    () => finish({ status: 'closed' })
  )
  activeSocket = socket
  const timer = setTimeout(() => finish({ status: 'timeout' }), REVIEW_TIMEOUT_MS)
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
    const { status, failureCode } = await finished
    if (status !== 'complete') {
      if (failureCode === CONTENT_REFUSAL_CODE) {
        throw new LilBotError('review_refused', 'The model refused to review this part of the conversation.')
      }
      if (failureCode === PROVIDER_POLICY_CODE) {
        throw new LilBotError('review_failed', 'The memory review failed because the provider blocked the request under account data-policy settings (provider_policy_blocked).')
      }
      const detail = failureCode ? `${String(status)}: ${failureCode}` : String(status)
      throw new LilBotError('review_failed', `The memory review did not finish (${detail}).`)
    }
  } finally {
    clearTimeout(timer)
    socket.close()
  }
}
