/** Switches a stored conversation to another model or reasoning effort from its next message, through `session.mutate`.
 *  Hermes keeps a change made during a turn and applies it at the turn's end. */
import { LilBotError } from '../../../shared/lilbot-error'
import type { SessionChange } from '../bot-engine'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { HermesSocket } from './hermes-socket'
import { contextFromInfo } from './hermes-usage'

/** The level a session reports it sends; null when it sends none (Hermes reports an empty string); undefined when the report does not carry it. */
export function wireEffort(info: Record<string, any> | undefined): string | null | undefined {
  if (!info || !('reasoning_effort_wire' in info)) return undefined
  return typeof info.reasoning_effort_wire === 'string' && info.reasoning_effort_wire ? info.reasoning_effort_wire : null
}

const RETRIES = 1

export async function updateSession(botId: string, chatId: string, change: SessionChange, connect = HermesSocket.connect) {
  const socket = await connect(
    botId === DEFAULT_PROFILE ? '' : botId,
    () => {},
    () => {}
  )
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await mutate(socket, chatId, change)
      } catch (error) {
        // Another edit landed between reading the session and changing it: read it again once.
        if (attempt < RETRIES && error instanceof LilBotError && error.code === 'hermes_revision_conflict') continue
        throw error
      }
    }
  } finally {
    socket.close()
  }
}

async function mutate(socket: Pick<HermesSocket, 'request'>, chatId: string, change: SessionChange) {
  const resume = () =>
    socket.request('session.resume', { session_id: chatId, source: 'gui', display_projection: true, omit_messages: true }).catch(error => {
      if (error instanceof LilBotError && error.code === 'hermes_not_found') return null
      throw error
    })
  const apply = async (operation: 'model' | 'reasoning', payload: Record<string, unknown>) => {
    const session = await resume()
    if (!session) return false
    const result = await socket.request('session.mutate', {
      session_id: session.session_id,
      request_id: crypto.randomUUID(),
      expected_revision: session.revision,
      expected_generation: session.execution_generation,
      operation,
      payload
    })
    // A committed change reports its revision. Without one the engine refused (a guard asks for a confirmation) and wrote nothing.
    if (typeof result.revision !== 'number') {
      throw new LilBotError(
        'confirm_required',
        'The engine asks for a confirmation before this conversation switches model, for example because it is long. The new model applies to new conversations.'
      )
    }
    return true
  }

  const { model, reasoningEffort } = change
  const level = typeof reasoningEffort === 'string' ? reasoningEffort : undefined
  if (model && !(await apply('model', { model: model.model, provider: model.provider, ...(level ? { reasoning: level } : {}) }))) return null
  if (reasoningEffort !== undefined && !(model && level) && !(await apply('reasoning', { effort: reasoningEffort }))) return null
  const session = await resume()
  if (!session) return null
  const context = contextFromInfo(session.info)
  return { effort: wireEffort(session.info) ?? null, ...(context ? { context } : {}) }
}
