/** Hermes' MCP client sends no session with a tool call (checked live: two sessions of one bot send identical
 *  requests), so LilBot learns which conversation made a call from the `tool.start` events its own sockets see: a
 *  chat it opened, a run it submitted, the activity observer's replay. */
import type { ToolCallSeen } from '../bot-engine'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'

const listeners = new Set<(call: ToolCallSeen) => void>()

export function onToolCall(listener: (call: ToolCallSeen) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** `profile` empty = the default profile. Reads only `tool_id`, `name` and `args`, all declared on `tool.start`. */
export function reportToolCall(profile: string, chatId: string | undefined, type: string, payload: Record<string, unknown> | undefined) {
  if (type !== 'tool.start' || !chatId || !payload) return
  const callId = typeof payload.tool_id === 'string' ? payload.tool_id : undefined
  const call = { engineBotId: profile || DEFAULT_PROFILE, chatId, tool: typeof payload.name === 'string' ? payload.name : '', args: payload.args ?? null, callId }
  for (const listener of listeners) listener(call)
}

/** A replayed batch of one session's events. Only calls still under way are reported: a call LilBot is matching waits for
 *  its start, so one that already completed in the same batch was answered before, and a session that is not running has
 *  none (its first read, or one after a reset, replays starts from long ago). */
export function reportReplay(profile: string, chatId: string, events: { type: string; payload?: Record<string, unknown> }[], idle: boolean) {
  if (idle) return
  const completed = new Set(events.flatMap(event => (event.type === 'tool.complete' && typeof event.payload?.tool_id === 'string' ? [event.payload.tool_id] : [])))
  for (const event of events) if (!(typeof event.payload?.tool_id === 'string' && completed.has(event.payload.tool_id))) reportToolCall(profile, chatId, event.type, event.payload)
}
