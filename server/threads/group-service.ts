/** Temporary groups, through the one `lilbot_group` tool: the leader starts a group with 2 to 4 other bots and a first
 *  point, says each next point (to all or to named members) and closes it with an outcome; a member attaches files to
 *  its reply; anyone in the group reads its status. Rounds run through the outbox (`group-rounds.ts`), endings through
 *  `group-end.ts`. The caller is always the key's bot. */
import { LilBotError } from '../../shared/lilbot-error'
import { type BotThread, GroupInput } from '../../shared/thread-schema'
import { refuseUnsafe } from '../memory/memory-safety'
import { checkFiles, stageFiles, withCopies } from './exchange-files'
import type { GroupEnding, GroupHost } from './group-end'
import { keepFiles } from './group-files'
import { groupFolder, makeGroupFolder } from './group-folder'
import { openRound } from './group-open'
import { type GroupStore, memberItemId } from './group-store'
import { botStatus } from './group-view'
import { type GroupLimits, THREAD_LIMITS } from './thread-limits'
import type { ThreadHost, ThreadService } from './thread-service'

type Bot = { id: string; name: string }
const need = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new LilBotError('group_input', `Give ${what}.`)
  return value
}

export class GroupService {
  constructor(
    private threads: ThreadService,
    private groups: GroupStore,
    readonly ending: GroupEnding,
    private host: GroupHost & ThreadHost,
    readonly limits: GroupLimits
  ) {}
  private get store() {
    return this.threads.store
  }
  private folder(botId: string) {
    if (!this.host.folder) throw new LilBotError('unavailable', 'Groups need bot folders.')
    return this.host.folder(botId)
  }

  async act(callerId: string, raw: GroupInput) {
    const input = GroupInput.parse(raw)
    const caller = await this.host.requireBot(callerId)
    if (input.action === 'start') return this.start(caller, input)
    const thread = this.store.get(need(input.groupId, 'the groupId'))
    if (!thread.group || !thread.participants.some(p => p.id === caller.id)) throw new LilBotError('thread_forbidden', 'You are not in that group.')
    if (input.action === 'status') return botStatus(this.threads.view(thread))
    if (input.action === 'attach') return this.attach(caller, thread, need(input.files, 'files'))
    if (thread.participants[0].id !== caller.id)
      throw new LilBotError('thread_forbidden', 'Only the leader says the next point and closes the group; reply in your final response.')
    return input.action === 'say' ? this.say(caller, thread, input) : this.close(caller, thread, input)
  }

  private async start(caller: Bot, input: GroupInput) {
    const requestId = need(input.requestId, 'a requestId')
    const prior = this.groups.byRequest(caller.id, requestId)
    if (prior) return botStatus(this.threads.view(this.store.get(prior)))
    const [purpose, text] = [need(input.purpose, 'the purpose'), need(input.text, 'the first point (text)')]
    refuseUnsafe(purpose)
    refuseUnsafe(text)
    const members = await Promise.all(need(input.members, `2 to ${this.limits.members} other bots as members`).map(m => this.threads.target(m)))
    if (members.some(m => m.id === caller.id)) throw new LilBotError('thread_self', 'You lead the group: name the other bots as members.')
    if (new Set(members.map(m => m.id)).size !== members.length || members.length > this.limits.members)
      throw new LilBotError('group_members', `Name 2 to ${this.limits.members} different bots as members.`)
    const chatId = await this.host.callingChat(caller.id, requestId)
    const depth = this.depthFrom(caller.id, chatId)
    if (this.groups.leading(caller.id) >= this.limits.perBot)
      throw new LilBotError('group_limit', `You already lead ${this.limits.perBot} running groups. Close one before starting another.`)
    const to = this.audience(members, input.to)
    const root = await this.folder(caller.id)
    await checkFiles(root, input.files ?? [])
    const parentId = this.host.work?.parentFor(caller.id, chatId, input.itemId) ?? null
    const id = crypto.randomUUID()
    const folder = groupFolder(this.host.root, id)
    await makeGroupFolder(this.host.root, id)
    await withCopies(root, input.files ?? [], folder, [], (copies, keep) =>
      this.store.db.transaction(() => {
        if (this.groups.byRequest(caller.id, requestId)) return
        const at = Date.now()
        const participants = [caller, ...members].map(({ id, name }) => ({ id, name }))
        const group = { purpose, roundCap: this.limits.rounds, rounds: [], turns: 0, lastAt: at, end: null, kept: [], folder, seen: {} }
        const thread: BotThread = {
          id,
          participants,
          createdAt: at,
          depth,
          state: 'open',
          messages: [],
          batchId: null,
          parentId,
          status: 'working',
          activity: null,
          startedAt: at,
          endedAt: null,
          stoppedBy: null,
          group
        }
        this.groups.add({ thread_id: id, leader_id: caller.id, request_id: requestId, source_chat: chatId, created_at: at }, parentId)
        const items = parentId ? members.map(m => ({ id: memberItemId(id, m.id), owner: m, asker: caller, task: purpose, groupId: id })) : []
        if (parentId) this.host.work!.groupChildren(parentId, items)
        openRound(this.threads, thread, to, text, requestId, copies, chatId, this.limits)
        keep()
      })()
    )
    this.pushed()
    return botStatus(this.threads.view(this.store.get(this.groups.byRequest(caller.id, requestId)!)))
  }

  /** No group inside a group; a group started from an exchange counts toward the exchange depth. */
  private depthFrom(callerId: string, chatId: string) {
    const root = this.host.rootOf(callerId, chatId)
    if (root === null) throw new LilBotError('session_unknown', 'LilBot cannot tell where this session came from just now. Try again in a moment.')
    const parent = this.store.context(callerId, chatId)?.thread_id ?? this.store.context(callerId, root)?.thread_id
    const thread = parent ? this.store.get(parent) : null
    if (thread?.group) throw new LilBotError('group_nested', 'No group inside a group. You may hand work to a single bot with lilbot_delegate.')
    if (thread?.worker) throw new LilBotError('thread_worker_nested', 'A worker cannot start a group. Do the work yourself or report back.')
    if (thread && thread.depth + 1 > THREAD_LIMITS.depth) throw new LilBotError('thread_depth', 'Maximum thread depth reached. Report back to whoever asked you.')
    return thread ? thread.depth + 1 : 1
  }

  /** The members a point is for: those named (ids or exact names), or all of them. */
  private audience(members: Bot[], to: string[] | undefined) {
    if (!to) return members.map(m => m.id)
    const ids = to.map(t => members.find(m => m.id === t || m.name === t)?.id)
    if (ids.some(id => !id)) throw new LilBotError('thread_target', 'Address only members of the group, by id or exact name.')
    return [...new Set(ids as string[])]
  }

  private async say(caller: Bot, thread: BotThread, input: GroupInput) {
    const requestId = need(input.requestId, 'a requestId')
    const g = thread.group!
    if (g.rounds.some(r => r.requestId === requestId)) return botStatus(this.threads.view(thread))
    if (g.end) throw new LilBotError('group_ended', 'This group has ended; it is read-only.')
    const busy = () => this.groups.unfinished(thread.id).some(d => d.kind === 'point')
    if (busy()) throw new LilBotError('group_busy', `Round ${g.rounds.length} is under way: its replies reach you in the group's session. Say the next point after them.`)
    const text = need(input.text, 'the point (text)')
    refuseUnsafe(text)
    const to = this.audience(thread.participants.slice(1), input.to)
    const room = this.limits.messages - thread.messages.length
    if (1 + to.length > room) throw new LilBotError('group_limit', `Only ${room} more messages fit in this group: put the point to fewer members, or close it.`)
    const root = await this.folder(caller.id)
    await checkFiles(root, input.files ?? [])
    const source = this.groups.row(thread.id)!.source_chat
    await withCopies(root, input.files ?? [], g.folder, [], (copies, keep) =>
      this.store.db.transaction(() => {
        const now = this.store.get(thread.id)
        if (now.group!.end || now.group!.rounds.some(r => r.requestId === requestId) || busy()) return
        openRound(this.threads, now, to, text, requestId, copies, source, this.limits)
        keep()
      })()
    )
    this.pushed()
    return botStatus(this.threads.view(this.store.get(thread.id)))
  }

  /** A member's files for its reply: checked now, copied into the group folder when the reply is in. */
  private async attach(caller: Bot, thread: BotThread, files: string[]) {
    const d = this.threads.runner.runningIn(thread.id).find(r => r.target === caller.id && r.kind !== 'round')
    if (!d) throw new LilBotError('not_running', 'Attach files while you work on a point of this group; they go to the group with your reply.')
    const names = await stageFiles(this.threads.files, await this.folder(caller.id), { threadId: thread.id, messageId: `${d.id}:reply`, sender: caller.id }, files)
    return { groupId: thread.id, files: names, note: 'They are copied into the group folder with your reply.' }
  }

  private async close(caller: Bot, thread: BotThread, input: GroupInput) {
    if (thread.group!.end) return botStatus(this.threads.view(thread))
    const outcome = need(input.text, 'the outcome (text)')
    refuseUnsafe(outcome)
    const source = this.groups.row(thread.id)!.source_chat
    const kept = await keepFiles(this.threads.files, thread, await this.folder(caller.id), input.keep ?? [], (path, title) => this.host.give(caller.id, path, title, source))
    if (this.store.db.transaction(() => this.ending.end(thread.id, 'closed', outcome, { kept }))()) await this.ending.settle(thread.id, true)
    return botStatus(this.threads.view(this.store.get(thread.id)))
  }

  /** Oscar stops a group: every bot in it stops at once, and the leader is told in its own conversation. */
  async stop(groupId: string) {
    if (this.store.db.transaction(() => this.ending.end(groupId, 'stopped', '', { stoppedBy: { kind: 'oscar', id: null, name: 'Oscar' } }))()) await this.ending.settle(groupId)
    return this.threads.view(this.store.get(groupId))
  }

  private pushed() {
    this.threads.changed()
    this.host.rosterChanged()
  }
}
