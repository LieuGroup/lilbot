/** A temporary group's part in the outbox (`thread-runner.ts`): which deliveries work in a group, what a finished turn
 *  adds to the transcript, and when a round is complete. Every step runs in one transaction with fixed delivery ids, so
 *  a restart never repeats a round's replies or loses one. */
import type { ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { BotThread, ThreadMessage } from '../../shared/thread-schema'
import { copyFile } from './exchange-files'
import type { GroupEnding } from './group-end'
import { filesLine, leaderPrompt, newsFor } from './group-prompts'
import { type GroupStore, roundOf } from './group-store'
import type { ThreadFiles } from './thread-files'
import type { GroupLimits } from './thread-limits'
import type { Delivery, ThreadStore } from './thread-store'

export class GroupRounds {
  constructor(
    private store: ThreadStore,
    private groups: GroupStore,
    private files: ThreadFiles,
    private ending: GroupEnding,
    /** The bot's own folder, where the files it attaches are read. */
    private folder: (botId: string) => Promise<string>,
    private limits: GroupLimits,
    /** The group's record changed. */
    private changed: () => void
  ) {}

  owns(threadId: string) {
    return !!this.groups.row(threadId)
  }
  /** The group a delivery works in: its points and rounds, and an answer into a member's group session. */
  groupOf(d: Delivery) {
    const work = this.store.workThread(d)
    return work && this.owns(work) ? work : null
  }
  ended(groupId: string) {
    return this.groups.row(groupId)?.ended_at != null
  }

  /** A turn in the group ended. Its words join the transcript (withheld once the group has ended), files attached to
   *  it are copied into the group folder, and the round settles once every member its point was for is done. */
  async record(d: Delivery, groupId: string, items: ChatItem[]) {
    if (!this.ended(groupId)) await this.copyAttached(d, groupId)
    const ended = this.store.db.transaction(() => {
      if (this.store.delivery(d.id)?.status === 'done') return false
      const thread = this.store.get(groupId)
      const g = thread.group!
      const author = thread.participants.find(p => p.id === d.target)!
      const message: ThreadMessage = { id: `${d.id}:reply`, authorId: author.id, authorName: author.name, createdAt: Date.now(), items }
      const after = !!g.end && !(d.kind === 'round' && g.end.how === 'closed')
      if (d.kind === 'round') this.leaderTurn(thread, d, message, after)
      else thread.messages.push(after ? { ...message, withheld: true } : message)
      if (!g.end) Object.assign(g, { turns: g.turns + 1, lastAt: Date.now() })
      this.store.save(thread)
      this.store.setStatus(d.id, 'done')
      return !g.end && d.kind === 'point' && this.settle(groupId, roundOf(d))
    })()
    if (ended) await this.ending.settle(groupId)
    this.changed()
  }

  /** A point LilBot could not hand over (the member is gone) counts as that member's failed reply; the leader being
   *  unreachable ends the group; an outcome that cannot reach a deleted leader is dropped. */
  async failed(d: Delivery, error?: LilBotError) {
    const why = error?.code === 'session_not_found' ? 'the conversation no longer exists' : 'the bot is missing'
    if (d.kind === 'point') return this.record(d, d.threadId, [{ kind: 'error', text: `LilBot could not hand this point over: ${why}.` }])
    const ended = this.store.db.transaction(() => {
      this.store.setStatus(d.id, 'done')
      return d.kind === 'round' && this.ending.end(d.threadId, 'failed')
    })()
    if (ended) await this.ending.settle(d.threadId)
  }

  /** The leader's turn on a round's replies: its tool lines join the point it made in that turn, and without a point its
   *  words are a message of their own. */
  private leaderTurn(thread: BotThread, d: Delivery, message: ThreadMessage, after: boolean) {
    const next = thread.messages.find(m => m.round === roundOf(d) + 1)
    if (next) next.items = [...message.items.filter(i => i.kind === 'tool'), ...next.items]
    else thread.messages.push(after ? { ...message, withheld: true } : message)
  }

  /** Once every member a round's point was for is done, the replies go to the leader, or the group ends by itself at
   *  its round or message limit. True when it ended. */
  private settle(groupId: string, n: number) {
    const thread = this.store.get(groupId)
    const g = thread.group!
    if (g.rounds.length !== n || this.groups.points(groupId).some(p => roundOf(p) === n && p.status !== 'done')) return false
    const how = n >= g.roundCap ? 'rounds' : thread.messages.length + 2 > this.limits.messages ? 'messages' : null
    if (how) return this.ending.end(groupId, how)
    const leader = thread.participants[0]
    const news = newsFor(thread, leader.id)
    g.seen[leader.id] = thread.messages.length
    this.store.save(thread)
    const files = filesLine(thread, this.files.byMessage(groupId), news)
    this.store.enqueue(
      `group:${groupId}:${n}:leader`,
      groupId,
      leader.id,
      leader.id,
      this.groups.row(groupId)!.source_chat,
      leaderPrompt(thread, news, files, this.limits),
      'round'
    )
    return false
  }

  /** Files the bot attached during this turn, copied from its own folder into the group folder. One that vanished or
   *  became a link since is listed as not delivered. */
  private async copyAttached(d: Delivery, groupId: string) {
    const rows = this.files.forMessage(`${d.id}:reply`).filter(f => !f.copy)
    if (!rows.length) return
    const folder = this.store.get(groupId).group!.folder
    const from = await this.folder(d.target)
    for (const row of rows) {
      const copy = await copyFile(from, row.source, folder, []).catch(error => {
        if (error instanceof LilBotError) return null
        throw error
      })
      if (copy) this.files.copied(row.id, copy.copy, copy.sha256)
    }
  }
}
