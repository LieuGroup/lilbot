/** Opening a round of a temporary group, inside the caller's transaction: the leader's point joins the transcript with
 *  its files, and each member it is for gets one point delivery carrying only what is new to that member. */
import type { BotThread, ThreadMessage } from '../../shared/thread-schema'
import type { CopiedFile } from './exchange-files'
import { filesLine, memberPrompt, newsFor } from './group-prompts'
import { memberItemId, pointId } from './group-store'
import type { GroupLimits } from './thread-limits'
import type { ThreadService } from './thread-service'

export function openRound(threads: ThreadService, thread: BotThread, to: string[], text: string, requestId: string, copies: CopiedFile[], sourceChat: string, limits: GroupLimits) {
  const { store, files } = threads
  const g = thread.group!
  const leader = thread.participants[0]
  const n = g.rounds.length + 1
  const at = Date.now()
  const point: ThreadMessage = { id: `group:${thread.id}:${n}`, authorId: leader.id, authorName: leader.name, createdAt: at, items: [{ kind: 'assistant', text }], round: n }
  thread.messages.push(point)
  g.rounds.push({ n, to, at, requestId })
  for (const [i, c] of copies.entries())
    files.add({
      id: `${point.id}:${i}`,
      thread_id: thread.id,
      message_id: point.id,
      sender: leader.id,
      name: c.name,
      size: c.size,
      sha256: c.sha256,
      source: c.source,
      copy: c.copy
    })
  const byMessage = files.byMessage(thread.id)
  for (const memberId of to) {
    const news = newsFor(thread, memberId).filter(m => m.id !== point.id)
    // A member's first point names the work item LilBot opened for its part, when the group hangs under one.
    const itemId = !(memberId in g.seen) && thread.parentId ? memberItemId(thread.id, memberId) : null
    const prompt = memberPrompt(thread, memberId, point, news, filesLine(thread, byMessage, [...news, point]), itemId, limits)
    g.seen[memberId] = thread.messages.length
    store.enqueue(pointId(thread.id, n, memberId), thread.id, leader.id, memberId, sourceChat, prompt, 'point')
  }
  g.seen[leader.id] = thread.messages.length
  g.lastAt = at
  store.save(thread)
}
