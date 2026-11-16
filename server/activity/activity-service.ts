import type { ActivityEvent, BotActivity } from '../../shared/activity-schema'
import type { ActivityStore } from './activity-store'

const idle = { status: 'idle', text: '', machine: 'leader' } as const

/** Live state is per session; unread and viewing are per bot, shared by all clients. */
export class ActivityService {
  private sessions = new Map<string, Map<string, Omit<BotActivity, 'unread'>>>()
  private viewers = new Map<string, number>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  constructor(
    private store: ActivityStore,
    private changed: () => void,
    private settleMs = 8000
  ) {}
  state(botId: string): BotActivity {
    const states = [...(this.sessions.get(botId)?.values() ?? [])]
    const state = states.find(s => s.status === 'waiting') ?? states.find(s => s.status === 'working') ?? states.at(-1) ?? idle
    return { ...state, unread: this.store.unread(botId) }
  }
  cursor = (botId: string, chatId: string) => this.store.cursor(botId, chatId)
  observe(event: ActivityEvent) {
    if (!this.store.accept(event.botId, event.chatId, event.key)) return
    const key = JSON.stringify([event.botId, event.chatId])
    clearTimeout(this.timers.get(key))
    const sessions = this.sessions.get(event.botId) ?? new Map()
    this.sessions.set(event.botId, sessions)
    const text =
      event.status === 'working'
        ? toolActivity(event.tool)
        : event.status === 'waiting'
          ? 'Waiting for Oscar'
          : event.status === 'finished'
            ? 'Finished'
            : event.status === 'failed'
              ? 'Failed'
              : ''
    sessions.set(event.chatId, { status: event.status, text, machine: 'leader' })
    if (event.spoke && !this.viewers.get(event.botId)) this.store.setUnread(event.botId, true)
    this.changed()
    if (event.status === 'finished' || event.status === 'failed') {
      this.timers.set(
        key,
        setTimeout(() => {
          sessions.delete(event.chatId)
          this.timers.delete(key)
          this.changed()
        }, this.settleMs)
      )
    }
  }
  setUnread(botId: string, unread: boolean) {
    this.store.setUnread(botId, unread)
    this.changed()
  }
  view(botId: string): () => void {
    this.viewers.set(botId, (this.viewers.get(botId) ?? 0) + 1)
    this.setUnread(botId, false)
    let closed = false
    return () => {
      if (closed) return
      closed = true
      const count = (this.viewers.get(botId) ?? 1) - 1
      if (count) this.viewers.set(botId, count)
      else this.viewers.delete(botId)
    }
  }
  forgetBot(botId: string) {
    for (const [key, timer] of this.timers) {
      if (JSON.parse(key)[0] === botId) {
        clearTimeout(timer)
        this.timers.delete(key)
      }
    }
    this.sessions.delete(botId)
    this.viewers.delete(botId)
    this.store.forgetBot(botId)
  }
  close() {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}

function toolActivity(tool?: string): string {
  if (!tool) return 'Working'
  if (/terminal|exec|shell|command/.test(tool)) return 'Running commands'
  if (/search|browse|web/.test(tool)) return 'Searching the web'
  if (/read|file/.test(tool)) return 'Working with files'
  if (/memory|recall/.test(tool)) return 'Updating memory'
  return 'Using a tool'
}
