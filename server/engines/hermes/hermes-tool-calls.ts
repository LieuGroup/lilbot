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

/** `profile` empty = the default profile. Reads only `name` and `args`, both declared on `tool.start`. */
export function reportToolCall(profile: string, chatId: string | undefined, type: string, payload: Record<string, unknown> | undefined) {
  if (type !== 'tool.start' || !chatId || !payload) return
  const call = { engineBotId: profile || DEFAULT_PROFILE, chatId, tool: typeof payload.name === 'string' ? payload.name : '', args: payload.args ?? null }
  for (const listener of listeners) listener(call)
}
