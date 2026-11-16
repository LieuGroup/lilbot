/** Hermes session rows and events -> LilBot chat items and events. Only fields that Hermes' wire
 *  contract declares are read here; `tests/hermes-contract.test.ts` checks that they still exist. */
import type { ChatEvent, ChatItem } from '../../../shared/chat-schema'
import type { HermesEvent } from './hermes-socket'

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** `display_messages` from `session.create` / `session.resume`. */
export function itemsFromRows(rows: unknown): ChatItem[] {
  if (!Array.isArray(rows)) return []
  const items: ChatItem[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const { role, name, context, tool_call_id } = row as Record<string, unknown>
    const body = text((row as Record<string, unknown>).text)
    if (role === 'user' && body) items.push({ kind: 'user', text: body })
    if (role === 'assistant' && body) items.push({ kind: 'assistant', text: body })
    if (role === 'tool') items.push({ kind: 'tool', toolId: text(tool_call_id) || `stored-${items.length}`, name: text(name) || 'tool', detail: text(context), running: false })
  }
  return items
}

/** Hermes has no "failed" flag on a finished tool call; it is read from the tool's own result, the
 *  same way Hermes' clients do: success/ok false, an error message, or a non-zero exit code. */
export function toolFailed(result: unknown): boolean {
  let value = result
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return false
    }
  }
  if (!value || typeof value !== 'object') return false
  const { success, ok, error, exit_code } = value as Record<string, unknown>
  return success === false || ok === false || (typeof error === 'string' && error.length > 0) || (typeof exit_code === 'number' && exit_code !== 0)
}

/** One Hermes event as zero or one LilBot event. Events LilBot does not show return null. */
export function chatEventFrom(event: HermesEvent): ChatEvent | null {
  const { type, payload } = event
  switch (type) {
    case 'message.start':
      return { type: 'turn.started' }
    case 'thinking.delta':
      return payload.text ? { type: 'activity', text: text(payload.text) } : null
    case 'message.delta':
      return payload.text ? { type: 'text.delta', text: text(payload.text) } : null
    case 'tool.start':
      return { type: 'tool.started', toolId: text(payload.tool_id), name: text(payload.name) || 'tool', detail: text(payload.context) }
    case 'tool.complete':
      return { type: 'tool.finished', toolId: text(payload.tool_id), failed: toolFailed(payload.result) }
    case 'message.complete': {
      // Hermes' status is complete | error | interrupted.
      const status = payload.status === 'interrupted' ? 'stopped' : payload.status === 'error' ? 'failed' : 'completed'
      const contextTokens = payload.usage?.context_used
      return { type: 'turn.finished', status, text: text(payload.text), ...(typeof contextTokens === 'number' ? { contextTokens } : {}) }
    }
    case 'session.title':
      return payload.title ? { type: 'title', title: text(payload.title) } : null
    case 'error':
      return { type: 'error', message: text(payload.message) || 'The bot reported an error.' }
    default:
      return null
  }
}

/** Events after which Hermes no longer serves this session on this connection. */
export const sessionLostEvents = new Set(['session.reclaimed', 'session.replay_gap'])
