import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { combineTurnNotes } from '../../server/bots/bot-conversations'
import { CodingSwitchNotice, type CodingSwitchStartup, T3_OFF_OSCAR_NOTICE } from '../../server/connections/coding-switch-notice'
import { T3Grants } from '../../server/connections/t3-grant'
import { openDatabase } from '../../server/database/database'
import { HistoryStore } from '../../server/history/history-store'

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'coding-switch-test-'))
  return { dir, file: join(dir, 'coding-switch.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const startup = (notice: CodingSwitchNotice, patch: Partial<CodingSwitchStartup> = {}) =>
  notice.onStartup({
    t3Enabled: false,
    removedT3Skill: false,
    t3GrantIssuedAt: null,
    bots: ['b1'],
    mainChat: id => `${id}-main`,
    primaryBot: 'b1',
    postNotice: () => {},
    ...patch
  })

test('fresh T3-off startup with no removed t3-coding and no T3 grant emits no notices', () => {
  const t = tempFile()
  try {
    const notice = new CodingSwitchNotice(t.file)
    const posted: unknown[] = []
    startup(notice, { postNotice: (...args) => posted.push(args) })
    expect(posted).toEqual([])
    expect(notice.pending('b1', 'b1-main')).toBeNull()
  } finally {
    t.cleanup()
  }
})

test('removing t3-coding queues a persistent one-time TurnNotes notice for pre-switch main chats and skips fresh sessions', () => {
  const t = tempFile()
  try {
    startup(new CodingSwitchNotice(t.file), {
      removedT3Skill: true,
      bots: ['b1', 'b2'],
      mainChat: id => (id === 'b1' ? 'c1-old' : 'c2-old')
    })
    const reloaded = new CodingSwitchNotice(t.file)
    const first = reloaded.pending('b1', 'c1-old')
    expect(first?.text).toContain('lilbot-coding')
    expect(first?.text).toContain('Do not use T3 Code or the t3 CLI')
    expect(first?.text).not.toContain('continues in T3 Code')
    first!.taken()
    expect(reloaded.pending('b1', 'c1-old')).toBeNull()
    expect(new CodingSwitchNotice(t.file).pending('b1', 'c1-old')).toBeNull()

    // A bot that started a new session gets no redundant notice and clears its pending entry.
    expect(reloaded.pending('b2', 'c2-new')).toBeNull()
    expect(reloaded.pending('b2', 'c2-old')).toBeNull()
  } finally {
    t.cleanup()
  }
})

test('startup with T3 off and a stored T3 sign-in notifies Oscar once and includes the in-flight T3 task note for the bot', () => {
  const t = tempFile()
  try {
    const posted: { botId: string; chatId: string; issuedAt: number; detail: string }[] = []
    const run = (removedT3Skill: boolean) =>
      startup(new CodingSwitchNotice(t.file), {
        removedT3Skill,
        t3GrantIssuedAt: 1_700_000_000_000,
        bots: ['b2', 'b1'],
        postNotice: (botId, chatId, issuedAt, detail) => posted.push({ botId, chatId, issuedAt, detail })
      })
    run(true)
    expect(posted).toEqual([{ botId: 'b1', chatId: 'b1-main', issuedAt: 1_700_000_000_000, detail: T3_OFF_OSCAR_NOTICE }])
    run(false)
    expect(posted).toHaveLength(1)
    expect(readFileSync(t.file, 'utf8')).not.toContain('accessToken')

    const note = new CodingSwitchNotice(t.file).pending('b1', 'b1-main')
    expect(note?.text).toContain('continues in T3 Code and is no longer followed here')
    note!.taken()
    expect(new CodingSwitchNotice(t.file).pending('b1', 'b1-main')).toBeNull()
  } finally {
    t.cleanup()
  }
})

test('turning T3 back on clears pending pre-switch notes, forgetBot drops deleted bots, and combineTurnNotes merges sources', () => {
  const t = tempFile()
  try {
    const notice = new CodingSwitchNotice(t.file)
    startup(notice, { removedT3Skill: true, bots: ['b1', 'b2'] })
    notice.forgetBot('b2')
    expect(notice.pending('b2', 'b2-main')).toBeNull()

    let webhookTaken = 0
    const combined = combineTurnNotes({ pending: () => ({ text: 'webhook-note', taken: () => webhookTaken++ }) }, notice)
    const merged = combined.pending('b1', 'b1-main')
    expect(merged?.text).toContain('webhook-note')
    expect(merged?.text).toContain('lilbot-coding')
    merged!.taken()
    expect(webhookTaken).toBe(1)
    expect(notice.pending('b1', 'b1-main')).toBeNull()

    startup(notice, { removedT3Skill: true })
    expect(notice.pending('b1', 'b1-main')).not.toBeNull()
    startup(notice, { t3Enabled: true })
    expect(notice.pending('b1', 'b1-main')).toBeNull()
  } finally {
    t.cleanup()
  }
})

test('expired or revoked T3 grants do not post the Oscar notice or add the running-T3-task bot warning', () => {
  const t = tempFile()
  try {
    const now = 1_700_000_100_000
    const grants = new T3Grants(
      join(t.dir, 't3-grant.json'),
      () => {},
      () => now
    )
    for (const grant of [
      { accessToken: 'tok', expiresAt: now - 1000, issuedAt: now - 5000, scope: 'mcp', label: 'expired' },
      { accessToken: 'tok', expiresAt: now + 86_400_000, issuedAt: now - 2000, revokedAt: now - 500, scope: 'mcp', label: 'revoked' }
    ]) {
      grants.save(grant)
      const usable = grants.usable()
      expect(usable).toBeNull()
      const posted: unknown[] = []
      const notice = new CodingSwitchNotice(join(t.dir, `${grant.label}.json`))
      startup(notice, { removedT3Skill: true, t3GrantIssuedAt: usable ? usable.issuedAt : null, postNotice: (...args) => posted.push(args) })
      expect(posted).toEqual([])
      const note = notice.pending('b1', 'b1-main')
      expect(note?.text).toContain('lilbot-coding')
      expect(note?.text).not.toContain('continues in T3 Code')
    }
  } finally {
    t.cleanup()
  }
})

test('missing or corrupt coding-switch.json on a post-switch restart neither queues a pre-switch bot note nor re-posts the notice', () => {
  const t = tempFile()
  const db = openDatabase(':memory:')
  try {
    const history = new HistoryStore(db)
    const issuedAt = 1_700_000_000_000
    let posted = 0
    const start = (removedT3Skill: boolean, chatId: string) => {
      const notice = new CodingSwitchNotice(t.file)
      startup(notice, {
        removedT3Skill,
        t3GrantIssuedAt: issuedAt,
        mainChat: () => chatId,
        hasNotice: ts => history.hasItem(`t3-switch-notice:${ts}`),
        postNotice: (botId, chat, ts, detail) => {
          posted++
          history.session(botId, chat, ts)
          history.reference(botId, chat, { kind: 'tool', toolId: `t3-switch-notice:${ts}`, name: 'coding notice', detail, running: false }, ts)
        }
      })
      return notice
    }

    const first = start(true, 'chat-before')
    expect(posted).toBe(1)
    first.pending('b1', 'chat-before')!.taken()

    rmSync(t.file, { force: true })
    const afterDelete = start(false, 'chat-after')
    expect(posted).toBe(1)
    expect(afterDelete.pending('b1', 'chat-after')).toBeNull()

    writeFileSync(t.file, '{corrupt json')
    const afterCorrupt = start(false, 'chat-after')
    expect(posted).toBe(1)
    expect(afterCorrupt.pending('b1', 'chat-after')).toBeNull()
  } finally {
    db.close()
    t.cleanup()
  }
})
