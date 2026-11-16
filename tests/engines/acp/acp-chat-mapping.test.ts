import { expect, test } from 'bun:test'
import { mapUpdate, replayUpdate } from '../../../server/engines/acp/acp-chat-mapping'
import type { ChatItem } from '../../../shared/chat-schema'

test('ACP text, thought, tool completion, and title map to neutral events', () => {
  expect(mapUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } })).toEqual({ type: 'text.delta', text: 'hello' })
  expect(mapUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'private reasoning' } })).toEqual({ type: 'activity', text: 'Thinking…' })
  expect(mapUpdate({ sessionUpdate: 'tool_call', toolCallId: 't', title: 'read', kind: 'read', status: 'pending' })).toEqual({
    type: 'tool.started',
    toolId: 't',
    name: 'read',
    detail: 'read'
  })
  expect(mapUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'failed' })).toEqual({ type: 'tool.finished', toolId: 't', failed: true })
  expect(mapUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'in_progress' })).toBeNull()
  expect(mapUpdate({ sessionUpdate: 'session_info_update', title: 'Topic' })).toEqual({ type: 'title', title: 'Topic' })
  // A context meter is not input-token usage for the last model call.
  expect(mapUpdate({ sessionUpdate: 'usage_update', used: 123, size: 200 })).toBeNull()
})

test('load replay retains role and tool boundaries and combines text chunks', () => {
  const items: ChatItem[] = []
  replayUpdate(items, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'question' } })
  replayUpdate(items, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'one' } })
  replayUpdate(items, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' two' } })
  replayUpdate(items, { sessionUpdate: 'tool_call', toolCallId: 't', title: 'read', status: 'pending' })
  replayUpdate(items, { sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'failed' })
  replayUpdate(items, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'three' } })
  expect(items).toEqual([
    { kind: 'user', text: 'question' },
    { kind: 'assistant', text: 'one two' },
    { kind: 'tool', toolId: 't', name: 'read', detail: '', running: false, failed: true },
    { kind: 'assistant', text: 'three' }
  ])
})
