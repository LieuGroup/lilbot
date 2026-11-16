/** Thread references belong to LilBot, merged into main chats at the transport edge. */

import type { ChatItem } from '../../shared/chat-schema'
import type { BotThread } from '../../shared/thread-schema'

export function threadLine(thread: BotThread, botId: string): Extract<ChatItem, { kind: 'tool' }> {
  return {
    kind: 'tool',
    toolId: `thread:${thread.id}`,
    threadId: thread.id,
    name: thread.participants[0].id === botId ? 'message to' : 'message from',
    detail: thread.participants.find(p => p.id !== botId)!.name,
    running: false
  }
}

export function threadEvents(
  threads: { list(botId: string): BotThread[] },
  bots: { list(): { id: string }[] },
  prefs: { mainChat(botId: string): string | null },
  publish: (frame: import('../../shared/protocol').EventFrame) => void
) {
  publish({ event: 'threads.changed' })
  for (const bot of bots.list()) {
    const chatId = prefs.mainChat(bot.id)
    if (!chatId) continue
    for (const thread of threads.list(bot.id)) {
      const line = threadLine(thread, bot.id)
      publish({ event: 'chat', chatId, data: { type: 'thread', threadId: thread.id, name: line.name, detail: line.detail } })
    }
  }
}
