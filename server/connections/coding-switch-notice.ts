/** Deploy-safety notices when LilBot switches from T3 Code to native coding (default off):
 *  1. Existing main conversations created before the switch keep their frozen engine system prompt, so each gets a
 *     one-time model note via `TurnNotes` on Oscar's next message pointing it to `lilbot-coding` without losing the chat.
 *  2. When a stored T3 sign-in (`t3-grant.json`) exists at startup with T3 off, posts one quiet notice in the primary
 *     bot's main conversation (and includes it in the one-time bot note) that any running T3 task continues in T3 Code
 *     and is no longer followed here.
 *  Stores only bot/chat ids and the grant's `issuedAt` timestamp (never tokens or secrets) in `<data>/coding-switch.json`. */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

type PendingChat = { chatId: string; hadT3Grant: boolean }
interface SwitchState {
  pendingChats: Record<string, PendingChat>
  t3NoticeIssuedAt?: number
}

export const T3_OFF_OSCAR_NOTICE = 'Coding in LilBot is now native (T3 Code is off). Any T3 task still running continues in T3 Code and is no longer followed here.'

const botSwitchNote = (hadT3Grant: boolean) =>
  `[LilBot notice, not from the owner: Coding in LilBot has switched from T3 Code to native coding. This conversation started before the switch, so its earlier prompt is outdated: T3 Code (lilbot_t3) and the t3-coding skill have been removed. Do not use T3 Code or the t3 CLI. Read and follow the lilbot-coding skill (via lilbot_skill_read or skill_view) for all coding work from now on.${hadT3Grant ? ' Any T3 task that was still running continues in T3 Code and is no longer followed here.' : ''}]`

export interface CodingSwitchStartup {
  t3Enabled: boolean
  removedT3Skill: boolean
  t3GrantIssuedAt: number | null
  bots: string[]
  mainChat: (botId: string) => string | null
  primaryBot: string | null
  hasNotice?: (issuedAt: number) => boolean
  postNotice: (botId: string, chatId: string, issuedAt: number, detail: string) => void
}

export class CodingSwitchNotice {
  private state: SwitchState
  constructor(private file: string) {
    this.state = this.load()
  }

  onStartup({ t3Enabled, removedT3Skill, t3GrantIssuedAt, bots, mainChat, primaryBot, hasNotice, postNotice }: CodingSwitchStartup) {
    if (t3Enabled) {
      if (Object.keys(this.state.pendingChats).length) {
        this.state.pendingChats = {}
        this.save()
      }
      return
    }
    let dirty = false
    const hadT3Grant = t3GrantIssuedAt !== null
    if (removedT3Skill) {
      for (const botId of bots) {
        const chatId = mainChat(botId)
        if (!chatId) continue
        this.state.pendingChats[botId] = { chatId, hadT3Grant }
        dirty = true
      }
    }
    if (t3GrantIssuedAt !== null && this.state.t3NoticeIssuedAt !== t3GrantIssuedAt) {
      if (hasNotice?.(t3GrantIssuedAt)) {
        this.state.t3NoticeIssuedAt = t3GrantIssuedAt
        dirty = true
      } else {
        const ordered = primaryBot && bots.includes(primaryBot) ? [primaryBot, ...bots.filter(id => id !== primaryBot)] : bots
        const target = ordered.map(id => ({ id, chatId: mainChat(id) })).find(entry => entry.chatId)
        if (target?.chatId) {
          postNotice(target.id, target.chatId, t3GrantIssuedAt, T3_OFF_OSCAR_NOTICE)
          this.state.t3NoticeIssuedAt = t3GrantIssuedAt
          const existing = this.state.pendingChats[target.id]
          if (existing && existing.chatId === target.chatId) this.state.pendingChats[target.id] = { chatId: target.chatId, hadT3Grant: true }
          dirty = true
        }
      }
    }
    if (dirty) this.save()
  }

  pending(botId: string, chatId?: string): { text: string; taken: () => void } | null {
    const entry = this.state.pendingChats[botId]
    if (!entry) return null
    if (chatId && entry.chatId !== chatId) {
      delete this.state.pendingChats[botId]
      this.save()
      return null
    }
    return {
      text: botSwitchNote(entry.hadT3Grant),
      taken: () => {
        if (this.state.pendingChats[botId]?.chatId !== entry.chatId) return
        delete this.state.pendingChats[botId]
        this.save()
      }
    }
  }

  forgetBot(botId: string) {
    if (!(botId in this.state.pendingChats)) return
    delete this.state.pendingChats[botId]
    this.save()
  }

  private load(): SwitchState {
    if (!existsSync(this.file)) return { pendingChats: {} }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      const pendingChats: Record<string, PendingChat> = {}
      if (parsed?.pendingChats && typeof parsed.pendingChats === 'object') {
        for (const [botId, entry] of Object.entries(parsed.pendingChats)) {
          if (entry && typeof (entry as PendingChat).chatId === 'string') {
            pendingChats[botId] = { chatId: (entry as PendingChat).chatId, hadT3Grant: Boolean((entry as PendingChat).hadT3Grant) }
          }
        }
      }
      return { pendingChats, ...(typeof parsed?.t3NoticeIssuedAt === 'number' ? { t3NoticeIssuedAt: parsed.t3NoticeIssuedAt } : {}) }
    } catch {
      return { pendingChats: {} }
    }
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${crypto.randomUUID()}.tmp`
    writeFileSync(temp, `${JSON.stringify(this.state)}\n`, { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, this.file)
  }
}
