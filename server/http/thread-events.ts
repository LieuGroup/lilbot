/** Thread references belong to LilBot, merged into main chats at the transport edge. */

import type { ChatItem } from '../../shared/chat-schema'
import type { BotThread } from '../../shared/thread-schema'

function taskTitle(thread: BotThread) {
  const text = thread.messages[0]?.items.find(item => item.kind === 'assistant')?.text ?? ''
  const line = (text.split('\n').find(part => part.trim()) ?? '').replace(/^[#>*\-\s]+/, '').trim()
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line || 'Task'
}

export function threadLine(thread: BotThread, botId: string): Extract<ChatItem, { kind: 'tool' }> {
  const [first] = thread.participants
  const leads = first.id === botId
  return {
    kind: 'tool',
    toolId: `thread:${thread.id}`,
    threadId: thread.id,
    name: thread.group ? (leads ? 'group' : `in ${first.name}'s group`) : thread.worker ? 'worker' : leads ? 'message to' : 'message from',
    detail: thread.group ? thread.group.purpose : thread.worker ? taskTitle(thread) : thread.participants.find(p => p.id !== botId)!.name,
    running: false
  }
}

export function threadEvents(
  threads: { list(botId: string): BotThread[] },
  bots: { list(): { id: string }[] },
  prefs: { mainChat(botId: string): string | null },
  publish: (frame: import('../../shared/protocol').EventFrame) => void,
  record?: (botId: string, chatId: string, line: Extract<ChatItem, { kind: 'tool' }>, at: number) => void
) {
  publish({ event: 'threads.changed' })
  for (const bot of bots.list()) {
    const chatId = prefs.mainChat(bot.id)
    if (!chatId) continue
    for (const thread of threads.list(bot.id)) {
      const line = threadLine(thread, bot.id)
      record?.(bot.id, chatId, line, thread.createdAt)
      publish({
        event: 'chat',
        chatId,
        data: { type: 'thread', threadId: thread.id, name: line.name, detail: line.detail, ...(thread.failure ? { failure: thread.failure } : {}) }
      })
    }
  }
}
