/** How a temporary group ends, whichever way: its leader closes it, Oscar stops it, or it ends by itself (a limit, going
 *  quiet, its leader unreachable). The end is one transaction, once: the outcome is queued for the leader's own
 *  conversation and each member gets a private journal entry. What follows (stopping turns, dropping members' work
 *  items, archiving the folder) is retried until it is done. */
import { LilBotError } from '../../shared/lilbot-error'
import type { GroupEnd } from '../../shared/thread-schema'
import { backgroundFailure } from '../background'
import { type KeptFile, recordKept } from './group-files'
import { archiveGroupFolder, groupArchive } from './group-folder'
import { endPrompt, endReason, filesLine, journalTexts, newsFor } from './group-prompts'
import { endId, type GroupStore } from './group-store'
import type { ThreadFiles } from './thread-files'
import type { GroupLimits } from './thread-limits'
import type { ThreadRunner } from './thread-runner'
import type { ThreadStore } from './thread-store'

type Bot = { id: string; name: string }
/** The work board (#141): members' parts hang under the leader's item, as delegated work does. */
export interface GroupWork {
  /** The leader's item this group from `chatId` belongs to, or null; refuses an item that is not the leader's. */
  parentFor(callerId: string, chatId: string, itemId?: string): string | null
  /** Runs inside the group's transaction: one item per member, with these ids. */
  groupChildren(parentId: string, items: { id: string; owner: Bot; asker: Bot; task: string; groupId: string }[]): void
  /** Members' unfinished items for the group are dropped with this reason. */
  groupEnded(groupId: string, reason: string): void
}
export interface GroupHost {
  /** The workspaces folder, which holds each group's shared folder. */
  root: string
  /** Saves a private journal fact for a bot; throws a LilBotError when memory refuses it. */
  journal(botId: string, text: string, chatId: string | null): void
  /** Gives a file in the bot's own folder to its Library. */
  give(botId: string, path: string, title: string, chatId: string): Promise<void>
  /** The bot's session that made this call (matched by its request id); refuses when that cannot be known. */
  callingChat(botId: string, requestId: string): Promise<string>
  /** The session a chat's compression lineage began as; null when it cannot be read just now. */
  rootOf(botId: string, chatId: string): string | null
  work?: GroupWork
  /** The roster shows running groups. */
  rosterChanged(): void
}
const DROPPED: Record<string, string> = { closed: 'The group closed.', stopped: 'The group was stopped by Oscar.' }

export class GroupEnding {
  private settling = new Set<string>()
  private retryAt = new Map<string, number>()
  constructor(
    private store: ThreadStore,
    private groups: GroupStore,
    private files: ThreadFiles,
    private host: GroupHost & { stopRun?(botId: string, chatId: string): Promise<boolean> },
    /** The outbox, built after this. */
    private runner: () => ThreadRunner,
    /** Stops an exchange a member handed out from its group session, as that member. */
    private stopExchange: (threadId: string) => Promise<unknown>,
    private changed: () => void,
    readonly limits: GroupLimits
  ) {}

  /** Ends the group, inside the caller's transaction. False when it had ended already. */
  end(groupId: string, how: GroupEnd, outcome = '', extra: { stoppedBy?: { kind: 'oscar'; id: null; name: string }; kept?: KeptFile[] } = {}) {
    const thread = this.store.get(groupId)
    const g = thread.group!
    if (g.end) return false
    const at = Date.now()
    const running = this.runner().runningIn(groupId)
    // The leader's turn that closes the group counts; turns that end after it do not.
    if (how === 'closed' && running.some(d => d.kind === 'round')) g.turns += 1
    g.end = { how, at, outcome: how === 'closed' ? outcome : endReason(how, thread, this.limits) }
    if (extra.kept) g.kept = recordKept(this.files, groupId, extra.kept)
    Object.assign(thread, { status: how === 'stopped' ? 'cancelled' : how === 'failed' ? 'failed' : 'finished', endedAt: at })
    if (extra.stoppedBy) thread.stoppedBy = { ...extra.stoppedBy, at }
    const leader = thread.participants[0]
    const news = newsFor(thread, leader.id)
    g.seen[leader.id] = thread.messages.length
    this.store.save(thread)
    this.groups.ended(groupId, at)
    for (const d of this.groups.unfinished(groupId)) if (!running.some(r => r.id === d.id)) this.store.setStatus(d.id, 'done')
    const prompt = endPrompt(thread, news, filesLine(thread, this.files.byMessage(groupId), news), groupArchive(this.host.root, groupId), this.limits)
    this.store.enqueue(endId(groupId), groupId, leader.id, leader.id, this.groups.row(groupId)!.source_chat, prompt, 'notice')
    for (const member of thread.participants.slice(1)) this.journal(groupId, member.id, journalTexts(thread, member.id))
    return true
  }

  /** The first entry memory accepts; a refusal never blocks the end. */
  private journal(groupId: string, botId: string, texts: string[]) {
    for (const text of texts) {
      try {
        return this.host.journal(botId, text, this.store.session(groupId, botId) ?? null)
      } catch (error) {
        if (!(error instanceof LilBotError)) throw error
      }
    }
  }

  /** After the end: turns still running stop (on close, not the leader's own, which made the call), exchanges members
   *  handed out from the group stop, members' unfinished items for it are dropped and its folder is archived. */
  async settle(groupId: string, spareLeader = false) {
    if (this.settling.has(groupId)) return
    this.settling.add(groupId)
    try {
      const thread = this.store.get(groupId)
      const leader = thread.participants[0].id
      for (const d of this.runner().runningIn(groupId))
        if (d.chatId && !(spareLeader && d.target === leader)) await this.host.stopRun?.(d.target, d.chatId).catch(() => backgroundFailure('group stop'))
      for (const { threadId } of this.groups.handedOut(groupId)) await this.stopExchange(threadId).catch(() => backgroundFailure('group handed-out stop'))
      this.host.work?.groupEnded(groupId, DROPPED[thread.group!.end!.how] ?? 'The group ended by itself.')
      await archiveGroupFolder(this.host.root, groupId)
      this.groups.settled(groupId)
    } catch {
      // Logged and retried from `tick`: the group has ended either way.
      this.retryAt.set(groupId, Date.now() + 30_000)
      backgroundFailure('group settle')
      return
    } finally {
      this.settling.delete(groupId)
    }
    this.changed()
    this.host.rosterChanged()
  }

  /** Ends groups past their time limit and quiet ones (nothing queued or running, no point for a while), and finishes
   *  the after-end work an interrupted settle left. */
  tick(now = Date.now()) {
    for (const row of this.groups.running()) {
      const g = this.store.get(row.thread_id).group!
      const quiet = !this.groups.unfinished(row.thread_id).length && now - g.lastAt > this.limits.quietMinutes * 60_000
      const how = now - row.created_at > this.limits.minutes * 60_000 ? 'time' : quiet ? 'quiet' : null
      if (how && this.store.db.transaction(() => this.end(row.thread_id, how))()) this.changed()
    }
    for (const id of this.groups.unsettled()) if ((this.retryAt.get(id) ?? 0) <= now) void this.settle(id)
  }
}
