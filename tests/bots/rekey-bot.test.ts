import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanReferences, verifyDatabaseRekey } from '../../scripts/rekey/rekey-check'
import { tableRowCounts, waitHash } from '../../scripts/rekey/rekey-targets'
import { runRekey } from '../../scripts/rekey-bot'
import { defaultAvatar } from '../../shared/avatar'
import { createRekeyFixture, GROUP_ID, OLD_ID, OTHER_ID, SECRET_MEMORY, SECRET_MESSAGE, SECRET_TOKEN } from './rekey-fixture'

test('dry run previews counts without modifying DB or disk and never leaks secrets or private text', () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-dry-'))
  try {
    const f = createRekeyFixture(root)
    const dbBefore = new Database(join(f.dataDir, 'lilbot.db'), { readonly: true })
    const countsBefore = tableRowCounts(dbBefore)
    dbBefore.close()

    const proc = Bun.spawnSync(
      [
        'bun',
        'scripts/rekey-bot.ts',
        '--from',
        OLD_ID,
        '--data-dir',
        f.dataDir,
        '--workspaces-dir',
        f.workspacesDir,
        '--hermes-home',
        f.hermesHome,
        '--clear-main-chat',
        '--dry-run'
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const stdout = proc.stdout.toString()
    expect(proc.exitCode, proc.stderr.toString()).toBe(0)
    expect(stdout).toContain('Mode: dry-run')
    expect(stdout).toContain('Workspace: would-move | Archive: would-move')
    expect(stdout).not.toContain(SECRET_TOKEN)
    expect(stdout).not.toContain(SECRET_MESSAGE)
    expect(stdout).not.toContain(SECRET_MEMORY)

    // Nothing changed on disk or in SQLite.
    expect(existsSync(join(f.workspacesDir, OLD_ID))).toBe(true)
    expect(existsSync(join(f.profileDir, 'lilbot-applied.json'))).toBe(true)
    const dbAfter = new Database(join(f.dataDir, 'lilbot.db'), { readonly: true })
    expect(tableRowCounts(dbAfter)).toEqual(countsBefore)
    expect(dbAfter.query('SELECT id FROM bots WHERE id = ?').get(OLD_ID)).toBeTruthy()
    dbAfter.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('full re-key rewrites every table, worker same-bot row, composite key, JSON field, disk folder and Hermes file, and is idempotent', () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-apply-'))
  try {
    const f = createRekeyFixture(root)
    const beforeDb = new Database(join(f.dataDir, 'lilbot.db'), { readonly: true })
    const beforeCounts = tableRowCounts(beforeDb)
    beforeDb.close()

    const summary = runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: true, dryRun: false })
    expect(summary.mode).toBe('applied')
    expect(summary.to).toMatch(/^[0-9a-f-]{36}$/)
    expect(summary.engineBotId).toBe(OLD_ID)
    expect(summary.clearedMainChat).toBe(true)
    expect(summary.disk).toEqual({
      workspace: 'moved',
      archive: 'moved',
      hermes: { 'lilbot-memory.json': 'updated', 'lilbot-skills.json': 'updated', 'lilbot-computers.json': 'updated', 'lilbot-applied.json': 'removed' }
    })

    const newId = summary.to
    const db = new Database(join(f.dataDir, 'lilbot.db'), { readonly: true })
    try {
      const check = verifyDatabaseRekey(db, OLD_ID, newId, OLD_ID, beforeCounts, 1)
      expect(check.ok, check.failures.join('\n')).toBe(true)
      expect(scanReferences(db, OLD_ID, newId)).toEqual({})
      expect((db.query('SELECT engine_bot_id FROM bots WHERE id = ?').get(newId) as { engine_bot_id: string }).engine_bot_id).toBe(OLD_ID)
      expect(db.query('SELECT id FROM history_items WHERE bot = ? AND id = ?').get(newId, `hermes:${OLD_ID}:1`)).toBeTruthy()
      expect(db.query('SELECT row_id FROM message_origins WHERE bot_id = ? AND row_id = ?').get(newId, `hermes:${OLD_ID}:1`)).toBeTruthy()
      expect(db.query("SELECT bytes FROM computer_bytes WHERE bot_id = ''").get()).toEqual({ bytes: 42 })
      expect(db.query("SELECT level FROM work_levels WHERE kind = 'code' AND bot_id = ''").get()).toEqual({ level: 1 })
      expect(db.query("SELECT author FROM skills WHERE name = 's-oscar'").get()).toEqual({ author: 'oscar' })
      expect(db.query("SELECT target FROM system_changes WHERE tool = 'lilbot_section_create'").get()).toEqual({ target: OLD_ID })
      expect(db.query('SELECT id FROM bots WHERE id = ?').get(OTHER_ID)).toBeTruthy()
      expect(db.query('SELECT count(*) AS n FROM memory_checkpoint_reviewed WHERE bot_id = ?').get(OTHER_ID)).toEqual({ n: 1 })
      expect(db.query('SELECT count(*) AS n FROM memory_checkpoint_reviewed WHERE bot_id = ?').get(newId)).toEqual({ n: 0 })

      const av = defaultAvatar(OLD_ID)
      const prefs = db.query('SELECT avatar_shape, avatar_color, avatar_face_color, main_chat_id FROM bot_prefs WHERE bot_id = ?').get(newId) as any
      expect(prefs).toEqual({ avatar_shape: av.shape, avatar_color: av.color, avatar_face_color: av.faceColor ?? null, main_chat_id: null })

      expect(db.query("SELECT owner_id, asked_id FROM work_items WHERE id = 'wi-worker'").get()).toEqual({ owner_id: newId, asked_id: newId })
      expect(db.query('SELECT sender, target FROM thread_deliveries WHERE id = ?').get(`${newId}:wreq-1`)).toEqual({ sender: newId, target: newId })
      const workerThread = JSON.parse((db.query("SELECT data FROM threads WHERE id = 'thr-worker'").get() as { data: string }).data)
      expect(workerThread.participants.map((p: any) => p.id)).toEqual([newId, newId])
      expect(workerThread.messages.map((m: any) => m.id)).toEqual([`${newId}:wreq-1`, `${newId}:wreq-1:reply`])
      expect(workerThread.stoppedBy.id).toBe(newId)

      const newMemberItem = `${GROUP_ID}:${newId}`
      expect(db.query('SELECT id FROM work_items WHERE id = ?').get(newMemberItem)).toBeTruthy()
      expect(db.query("SELECT parent_id FROM work_items WHERE id = 'wi-child'").get()).toEqual({ parent_id: newMemberItem })
      expect(db.query("SELECT parent_id FROM thread_links WHERE thread_id = 'thr-sub'").get()).toEqual({ parent_id: newMemberItem })
      expect(db.query('SELECT id, item_id, by_id FROM work_evidence').get()).toEqual({ id: `${newMemberItem}:rq:0`, item_id: newMemberItem, by_id: newId })
      expect(db.query('SELECT id, item_id, checker_id FROM work_checks').get()).toEqual({ id: `${newMemberItem}:check:1`, item_id: newMemberItem, checker_id: newId })
      expect(db.query('SELECT check_id FROM work_check_chats').get()).toEqual({ check_id: `${newMemberItem}:check:1` })
      expect(db.query('SELECT item_id FROM goal_reviews').get()).toEqual({ item_id: newMemberItem })
      expect(db.query('SELECT id, delivery_id FROM thread_waits WHERE bot_id = ?').get(newId)).toEqual({
        id: waitHash(newId, JSON.stringify(['thr-worker'])),
        delivery_id: `${newId}:wreq-1`
      })
      const signIn = JSON.parse((db.query("SELECT item FROM history_items WHERE id = 'sign_in:card-1'").get() as { item: string }).item)
      expect(signIn.card.botId).toBe(newId)
      expect((db.query("SELECT count(*) AS n FROM history_search WHERE history_search MATCH 'private'").get() as { n: number }).n).toBe(1)
    } finally {
      db.close()
    }

    // Disk & Hermes files verified.
    expect(existsSync(join(f.workspacesDir, OLD_ID))).toBe(false)
    expect(readFileSync(join(f.workspacesDir, newId, 'note.txt'), 'utf8')).toBe('workspace-file')
    expect(readFileSync(join(f.workspacesDir, '.archive', newId, 'old.txt'), 'utf8')).toBe('archived-file')
    const mem = JSON.parse(readFileSync(join(f.profileDir, 'lilbot-memory.json'), 'utf8'))
    expect(mem.bot_id).toBe(newId)
    expect(mem.creation_capability).toBe(createHmac('sha256', SECRET_TOKEN).update(`create-bot:${newId}`).digest('hex'))
    expect(JSON.parse(readFileSync(join(f.profileDir, 'lilbot-skills.json'), 'utf8')).botId).toBe(newId)
    expect(JSON.parse(readFileSync(join(f.profileDir, 'lilbot-computers.json'), 'utf8')).botId).toBe(newId)
    expect(existsSync(join(f.profileDir, 'lilbot-applied.json'))).toBe(false)

    // Running a second time (without --to and with --to) is a clean idempotent no-op.
    const second = runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: true, dryRun: false })
    expect(second.mode).toBe('already-rekeyed')
    expect(second.to).toBe(newId)
    expect(second.totalChanges).toBe(0)
    expect(second.disk.workspace).toBe('already-moved')
    const third = runRekey({ from: OLD_ID, to: newId, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: true, dryRun: false })
    expect(third.mode).toBe('already-rekeyed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resumes cleanly after an interruption between DB commit and disk moves', () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-resume-'))
  try {
    const f = createRekeyFixture(root)
    const first = runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: false, dryRun: false })
    // Simulate interruption right after DB committed by moving workspace back and resetting Hermes memory file.
    renameSync(join(f.workspacesDir, first.to), join(f.workspacesDir, OLD_ID))
    writeFileSync(join(f.profileDir, 'lilbot-memory.json'), JSON.stringify({ url: 'http://127.0.0.1:3370', token_file: f.tokenFile, bot_id: OLD_ID }))

    const resumed = runRekey({ from: OLD_ID, to: first.to, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: false, dryRun: false })
    expect(resumed.mode).toBe('already-rekeyed')
    expect(resumed.disk.workspace).toBe('moved')
    expect(resumed.disk.hermes['lilbot-memory.json']).toBe('updated')
    expect(existsSync(join(f.workspacesDir, first.to, 'note.txt'))).toBe(true)

    // Self-check fails loudly if any stale reference to OLD_ID remains in a re-keyed column.
    const corrupt = new Database(join(f.dataDir, 'lilbot.db'))
    corrupt.query('INSERT INTO review_turns(bot_id, chat_id, user_text, assistant_text, created_at) VALUES (?, ?, ?, ?, 2000)').run(OLD_ID, 'c', 'u', 'a')
    corrupt.close()
    expect(() =>
      runRekey({ from: OLD_ID, to: first.to, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: false, dryRun: false })
    ).toThrow(/review_turns\.bot_id/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses to run while another process holds lilbot.db open', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-lock-'))
  const f = createRekeyFixture(root)
  const holder = Bun.spawn(
    [
      'bun',
      '-e',
      `import { Database } from 'bun:sqlite'; const db = new Database(${JSON.stringify(join(f.dataDir, 'lilbot.db'))}); console.log('open'); await Bun.sleep(10000); db.close()`
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe'
    }
  )
  try {
    const reader = holder.stdout.getReader()
    await reader.read()
    expect(() => runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: false, dryRun: false })).toThrow(
      /Refusing to run/
    )
  } finally {
    holder.kill()
    await holder.exited
    rmSync(root, { recursive: true, force: true })
  }
})
