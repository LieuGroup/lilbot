import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { ChatEvent, ChatItem } from '../../../shared/chat-schema'

export function mapUpdate(update: SessionUpdate): ChatEvent | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content.type === 'text' ? { type: 'text.delta', text: update.content.text } : null
    case 'agent_thought_chunk':
      return { type: 'activity', text: 'Thinking…' }
    case 'tool_call':
      return { type: 'tool.started', toolId: update.toolCallId, name: update.title, detail: update.kind ?? '' }
    case 'tool_call_update':
      return update.status === 'completed' || update.status === 'failed' ? { type: 'tool.finished', toolId: update.toolCallId, failed: update.status === 'failed' } : null
    case 'session_info_update':
      return update.title ? { type: 'title', title: update.title } : null
    default:
      return null
  }
}

/** ACP load replays chunks; merge adjacent messages but retain tool boundaries. */
export function replayUpdate(items: ChatItem[], update: SessionUpdate) {
  if (update.sessionUpdate === 'user_message_chunk' || update.sessionUpdate === 'agent_message_chunk') {
    if (update.content.type !== 'text') return
    const kind = update.sessionUpdate === 'user_message_chunk' ? 'user' : 'assistant'
    const last = items.at(-1)
    if (last?.kind === kind) last.text += update.content.text
    else items.push({ kind, text: update.content.text })
  } else if (update.sessionUpdate === 'tool_call') {
    items.push({ kind: 'tool', toolId: update.toolCallId, name: update.title, detail: update.kind ?? '', running: false })
  } else if (update.sessionUpdate === 'tool_call_update') {
    const tool = items.find(item => item.kind === 'tool' && item.toolId === update.toolCallId)
    if (tool?.kind === 'tool') tool.failed = update.status === 'failed'
  }
}
