import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { combineTurnNotes } from '../../server/bots/bot-conversations'
import { CodingSwitchNotice, T3_OFF_OSCAR_NOTICE } from '../../server/connections/coding-switch-notice'

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'coding-switch-test-'))
  return { dir, file: join(dir, 'coding-switch.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('fresh T3-off startup with no removed t3-coding and no T3 grant emits no notices', () => {
  const t = tempFile()
  try {
    const notice = new CodingSwitchNotice(t.file)
    const posted: unknown[] = []
    notice.onStartup({
      t3Enabled: false,
      removedT3Skill: false,
      t3GrantIssuedAt: null,
      bots: ['b1'],
      mainChat: () => 'c1',
      primaryBot: 'b1',
      postNotice: (...args) => posted.push(args)
    })
    expect(posted).toEqual([])
    expect(notice.pending('b1', 'c1')).toBeNull()
  } finally {
    t.cleanup()
  }
})

test('removing t3-coding queues a persistent one-time TurnNotes notice for pre-switch main chats and skips fresh sessions', () => {
  const t = tempFile()
  try {
    const notice = new CodingSwitchNotice(t.file)
    notice.onStartup({
      t3Enabled: false,
      removedT3Skill: true,
      t3GrantIssuedAt: null,
      bots: ['b1', 'b2'],
      mainChat: id => (id === 'b1' ? 'c1-old' : 'c2-old'),
      primaryBot: 'b1',
      postNotice: () => {}
    })
    // Survives another restart before Oscar sends a message.
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
      new CodingSwitchNotice(t.file).onStartup({
        t3Enabled: false,
        removedT3Skill,
        t3GrantIssuedAt: 1700000000000,
        bots: ['b2', 'b1'],
        mainChat: id => `${id}-main`,
        primaryBot: 'b1',
        postNotice: (botId, chatId, issuedAt, detail) => posted.push({ botId, chatId, issuedAt, detail })
      })
    run(true)
    expect(posted).toEqual([{ botId: 'b1', chatId: 'b1-main', issuedAt: 1700000000000, detail: T3_OFF_OSCAR_NOTICE }])
    // A second restart with the same stored grant does not repeat Oscar's notice.
    run(false)
    expect(posted).toHaveLength(1)
    const stored = readFileSync(t.file, 'utf8')
    expect(stored).not.toContain('accessToken')

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
    notice.onStartup({
      t3Enabled: false,
      removedT3Skill: true,
      t3GrantIssuedAt: null,
      bots: ['b1', 'b2'],
      mainChat: id => `${id}-main`,
      primaryBot: 'b1',
      postNotice: () => {}
    })
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

    // Re-queue then enable T3: pending native note must be cleared.
    notice.onStartup({
      t3Enabled: false,
      removedT3Skill: true,
      t3GrantIssuedAt: null,
      bots: ['b1'],
      mainChat: () => 'b1-main',
      primaryBot: 'b1',
      postNotice: () => {}
    })
    expect(notice.pending('b1', 'b1-main')).not.toBeNull()
    notice.onStartup({
      t3Enabled: true,
      removedT3Skill: false,
      t3GrantIssuedAt: null,
      bots: ['b1'],
      mainChat: () => 'b1-main',
      primaryBot: 'b1',
      postNotice: () => {}
    })
    expect(notice.pending('b1', 'b1-main')).toBeNull()
  } finally {
    t.cleanup()
  }
})
