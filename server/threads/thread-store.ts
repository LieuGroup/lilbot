import type { Database } from 'bun:sqlite'
import type { ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/protocol'
import type { BotThread, ThreadAsk, ThreadMessage } from '../../shared/thread-schema'
import { THREAD_LIMITS } from './thread-limits'

export interface Delivery {
  id: string
  threadId: string
  sender: string
  target: string
  sourceChat: string
  text: string
  kind: 'request' | 'answer'
  base: number | null
  status: string
}
export class ThreadStore {
  constructor(readonly db: Database) {}
  get(id: string): BotThread {
    const row = this.db.query('SELECT data FROM threads WHERE id=?').get(id) as { data: string } | null
    if (!row) throw new LilBotError('thread_missing', 'Thread not found.')
    return JSON.parse(row.data)
  }
  save(thread: BotThread) {
    this.db.query('INSERT OR REPLACE INTO threads(id,data) VALUES(?,?)').run(thread.id, JSON.stringify(thread))
  }
  list(botId: string): BotThread[] {
    return (this.db.query('SELECT data FROM threads ORDER BY rowid DESC').all() as { data: string }[])
      .map(r => JSON.parse(r.data))
      .filter(t => t.participants.some((p: { id: string }) => p.id === botId))
  }
  context(botId: string, chatId: string) {
    return this.db.query('SELECT thread_id FROM thread_chats WHERE bot_id=? AND chat_id=?').get(botId, chatId) as { thread_id: string } | null
  }
  session(threadId: string, botId: string): string | undefined {
    return (this.db.query('SELECT chat_id FROM thread_chats WHERE thread_id=? AND bot_id=? ORDER BY rowid LIMIT 1').get(threadId, botId) as { chat_id: string } | null)?.chat_id
  }
  isInternal(chatId: string) {
    return !!this.db.query('SELECT 1 FROM thread_chats WHERE chat_id=?').get(chatId)
  }
  delivery(id: string): Delivery | null {
    return this.db.query('SELECT * FROM thread_deliveries WHERE id=?').get(id) as Delivery | null
  }
  accept(caller: { id: string; name: string }, target: { id: string; name: string }, input: ThreadAsk) {
    return this.db.transaction(() => {
      const id = `${caller.id}:${input.requestId}`
      const prior = this.delivery(id)
      if (prior) return prior
      if (caller.id === target.id) throw new LilBotError('thread_self', 'You cannot ask yourself.')
      const parent = this.context(caller.id, input.chatId)
      const depth = parent ? this.get(parent.thread_id).depth + 1 : 1
      const thread = input.threadId
        ? this.get(input.threadId)
        : {
            id: crypto.randomUUID(),
            participants: [caller, target].map(({ id, name }) => ({ id, name })),
            createdAt: Date.now(),
            depth,
            state: 'open' as const,
            messages: []
          }
      if (!thread.participants.some(p => p.id === caller.id) || !thread.participants.some(p => p.id === target.id))
        throw new LilBotError('thread_forbidden', 'Only the two participants can use this thread.')
      if ((!input.threadId && depth > THREAD_LIMITS.depth) || thread.depth > THREAD_LIMITS.depth)
        throw new LilBotError('thread_depth', 'Maximum thread depth reached. Report back to whoever asked you.')
      // Pending requests reserve their answer; continuations reserve through append below.
      const pending = (this.db.query("SELECT count(*) AS n FROM thread_deliveries WHERE threadId=? AND kind='request' AND status!='done'").get(thread.id) as { n: number }).n
      if (thread.state !== 'open' || thread.messages.length + pending + 2 > THREAD_LIMITS.messages)
        throw new LilBotError('thread_limit', 'Thread message limit reached. Report back to whoever asked you.')
      thread.messages.push({ id, authorId: caller.id, authorName: caller.name, createdAt: Date.now(), items: [{ kind: 'assistant', text: input.text }] })
      this.save(thread)
      this.db
        .query('INSERT INTO thread_deliveries(id,threadId,sender,target,sourceChat,text,kind) VALUES(?,?,?,?,?,?,?)')
        .run(id, thread.id, caller.id, target.id, input.chatId, input.text, 'request')
      return this.delivery(id)!
    })()
  }
  origin(threadId: string, target: string): Delivery | null {
    return this.db.query("SELECT * FROM thread_deliveries WHERE threadId=? AND target=? AND kind='request' ORDER BY rowid DESC LIMIT 1").get(threadId, target) as Delivery | null
  }
  pending(): Delivery[] {
    return this.db.query("SELECT * FROM thread_deliveries WHERE status!='done' ORDER BY rowid").all() as Delivery[]
  }
  attach(d: Delivery, botId: string, chatId: string, internal: boolean) {
    const context = d.kind === 'answer' ? this.context(botId, d.sourceChat)?.thread_id : d.threadId
    if (internal && context) this.db.query('INSERT OR IGNORE INTO thread_chats(chat_id,bot_id,thread_id) VALUES(?,?,?)').run(chatId, botId, context)
    this.db.query('UPDATE thread_deliveries SET chatId=? WHERE id=?').run(chatId, d.id)
  }
  baseline(id: string, length: number) {
    this.db.query('UPDATE thread_deliveries SET base=coalesce(base,?) WHERE id=?').run(length, id)
    return this.delivery(id)!.base!
  }
  finish(d: Delivery, items: ChatItem[], response?: { target: string; sourceChat: string; threadId: string }) {
    this.db.transaction(() => {
      if (this.delivery(d.id)?.status === 'done') return
      if (response) {
        const thread = this.get(response.threadId)
        if (thread.messages.length < THREAD_LIMITS.messages) {
          const author = thread.participants.find(p => p.id === d.target)!
          const message: ThreadMessage = { id: `${d.id}:reply`, authorId: author.id, authorName: author.name, createdAt: Date.now(), items }
          thread.messages.push(message)
          if (thread.messages.length >= THREAD_LIMITS.messages) thread.state = 'limited'
          this.save(thread)
          const text =
            items
              .filter(i => i.kind === 'assistant')
              .map(i => i.text)
              .join('\n\n') || 'The bot finished without an answer.'
          this.db
            .query('INSERT OR IGNORE INTO thread_deliveries(id,threadId,sender,target,sourceChat,text,kind) VALUES(?,?,?,?,?,?,?)')
            .run(message.id, thread.id, d.target, response.target, response.sourceChat, text, 'answer')
        }
      }
      this.db.query("UPDATE thread_deliveries SET status='done' WHERE id=?").run(d.id)
    })()
  }
  fail(d: Delivery) {
    const thread = this.get(d.threadId)
    thread.state = 'failed'
    this.save(thread)
    this.db.query("UPDATE thread_deliveries SET status='done' WHERE id=?").run(d.id)
  }
}
