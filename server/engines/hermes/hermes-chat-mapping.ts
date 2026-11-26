/** Hermes session rows and events -> LilBot chat items and events. Only fields that Hermes' wire
 *  contract declares are read here; `tests/engines/hermes/hermes-contract.test.ts` checks that they still exist. */
import type { ChatEvent, ChatItem } from '../../../shared/chat-schema'
import { isShowTool } from '../../../shared/shown-schema'
import type { HermesEvent } from './hermes-socket'
import { unwrapToolCalls } from './hermes-tool-calls'
import { rowIdFromComplete, type TurnUsageTracker } from './hermes-usage'

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** A stored row for `lilbot_show` (#317), also when Hermes' tool search wrapped it in `tool_call`: its `shown` item
 *  replaces it, so the row is not drawn. Live events already carry the unwrapped name. */
function showRow(name: string, args: unknown) {
  if (isShowTool(name)) return true
  const calls = name === 'tool_call' ? unwrapToolCalls(name, args) : []
  return calls.length > 0 && calls.every(call => isShowTool(call.name))
}

/** `display_messages` from `session.create` / `session.resume`. `failedSave` says whether a row that closes a failed turn
 *  (`display_kind` `failed_turn`, at its `timestamp` in seconds) closes one that stopped for want of the memory save. */
export function itemsFromRows(rows: unknown, failedSave?: (at: number) => boolean): ChatItem[] {
  if (!Array.isArray(rows)) return []
  const items: ChatItem[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const { role, name, context, tool_call_id } = row as Record<string, unknown>
    const body = text((row as Record<string, unknown>).text)
    if (role === 'user' && body) items.push({ kind: 'user', text: body })
    const at = (row as Record<string, unknown>).timestamp
    const unsaved = role === 'assistant' && (row as Record<string, unknown>).display_kind === 'failed_turn' && typeof at === 'number' && failedSave?.(at * 1000)
    if (unsaved) items.push({ kind: 'error', text: '', reason: 'memory_save' })
    else if (role === 'assistant' && body) items.push({ kind: 'assistant', text: body })
    if (role === 'tool' && !showRow(text(name), (row as Record<string, unknown>).args))
      items.push({
        kind: 'tool',
        toolId: text(tool_call_id) || `stored-${items.length}`,
        name: text(name) || 'tool',
        detail: text(context),
        running: false,
        ...(row.content == null ? {} : { failed: toolFailed(row.content), result: typeof row.content === 'string' ? row.content : JSON.stringify(row.content) })
      })
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

/** One Hermes event as zero or one LilBot event. Events LilBot does not show return null. `failedSave` says whether the
 *  session's memory save before compressing failed, which a failed turn then reports instead of the engine's text. */
export function chatEventFrom(event: HermesEvent, failedSave?: () => boolean, track?: { tracker: TurnUsageTracker; nativeId: string }): ChatEvent | null {
  const { type, payload } = event
  switch (type) {
    case 'message.start':
      track?.tracker.onTurnStart()
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
      const tracked = track?.tracker.onComplete(payload)
      const contextTokens = tracked?.contextTokens ?? (typeof payload.usage?.context_used === 'number' ? payload.usage.context_used : undefined)
      const rowId = track ? rowIdFromComplete(track.nativeId, payload) : undefined
      const meta = {
        ...(contextTokens !== undefined ? { contextTokens } : {}),
        ...(tracked?.usage ? { usage: tracked.usage } : {}),
        ...(rowId ? { rowId } : {}),
        ...(tracked?.compacted ? { compacted: tracked.compacted } : {})
      }
      if (status === 'failed' && failedSave?.()) return { type: 'turn.finished', status, text: '', failure: 'memory_save', ...meta }
      return { type: 'turn.finished', status, text: text(payload.text), ...meta }
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
