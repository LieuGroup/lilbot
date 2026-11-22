import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRekey, runUndo } from '../../scripts/rekey-bot'
import { defaultAvatar } from '../../shared/avatar'
import {
  createRekeyFixture,
  DECOY_ID,
  GROUP_ID,
  OLD_ID,
  OTHER_ID,
  SECRET_ENV,
  SECRET_KEY,
  SECRET_MEMORY,
  SECRET_MESSAGE,
  SECRET_TOKEN,
  scanEveryTableColumn
} from './rekey-fixture'

const REPO = join(import.meta.dir, '../..')

function cli(args: string[]) {
  const proc = Bun.spawnSync(['bun', 'scripts/rekey-bot.ts', ...args], { cwd: REPO, stdout: 'pipe', stderr: 'pipe' })
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() }
}

test('dry run previews counts without modifying DB or disk and never leaks secrets or private text', () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-dry-'))
  try {
    const f = createRekeyFixture(root)
    const out = cli(['--from', OLD_ID, '--data-dir', f.dataDir, '--workspaces-dir', f.workspacesDir, '--hermes-home', f.hermesHome, '--clear-main-chat'])
    expect(out.code, out.stderr).toBe(0)
    expect(out.stdout).toContain('Mode: dry-run')
    for (const secret of [SECRET_TOKEN, SECRET_KEY, SECRET_ENV.trim(), SECRET_MESSAGE, SECRET_MEMORY]) {
      expect(out.stdout).not.toContain(secret)
      expect(out.stderr).not.toContain(secret)
    }
    const db = new Database(f.dbPath, { readonly: true })
    expect(db.query('SELECT id FROM bots WHERE id = ?').get(OLD_ID)).toBeTruthy()
    db.close()
    expect(existsSync(join(f.workspacesDir, OLD_ID))).toBe(true)
    expect(existsSync(join(f.profileDir, 'lilbot-applied.json'))).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('full re-key covers every table and all 6 composite shapes, passes schema-wide brute-force scan, spares underscore decoy, is idempotent, and supports --undo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-full-'))
  try {
    const f = createRekeyFixture(root)
    const newId = 'new-bot-uuid-1234'
    const applied = await runRekey({ from: OLD_ID, to: newId, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: true, dryRun: false })
    expect(applied.mode).toBe('applied')
    expect(applied.backupDir && existsSync(join(applied.backupDir, 'lilbot.db'))).toBe(true)
    expect(applied.backupDir && existsSync(join(applied.backupDir, 'computer-server-key.pem'))).toBe(true)
    expect(applied.backupDir && existsSync(join(applied.backupDir, 'hermes', '.env'))).toBe(true)
    expect(applied.clearedMainChat).toBe(true)
    expect(applied.disk).toEqual({
      workspace: 'moved',
      archive: 'moved',
      hermes: { 'lilbot-memory.json': 'updated', 'lilbot-skills.json': 'updated', 'lilbot-computers.json': 'updated', 'lilbot-applied.json': 'removed' }
    })

    const db = new Database(f.dbPath, { readonly: true })
    // Schema-wide brute-force check: ZERO remaining OLD_ID anywhere outside explicitly kept invariants.
    const leaks = scanEveryTableColumn(db, OLD_ID, (table, col, val) => {
      if (table === 'bots' && col === 'engine_bot_id' && val === OLD_ID) return true
      if ((table === 'history_items' && col === 'id') || (table === 'message_origins' && col === 'row_id')) return val.startsWith(`hermes:${OLD_ID}:`)
      if ((table === 'history_turn_usage' || table === 'history_compactions') && col === 'row_id') return val.startsWith(`hermes:${OLD_ID}:`)
      return false
    })
    expect(leaks).toEqual([])

    const newMember = `${GROUP_ID}:${newId}`
    const newCheck = `${newMember}:check:1`
    expect(db.query('SELECT id FROM thread_files WHERE message_id = ?').get(`${newId}:wreq-1`)).toEqual({ id: `${newId}:wreq-1:0` })
    expect(db.query('SELECT id FROM thread_files WHERE message_id = ?').get(`group:${GROUP_ID}:1:${newId}:reply`)).toEqual({ id: `group:${GROUP_ID}:1:${newId}:reply:0` })
    // Decoy bot (`legacyXbot`) must be untouched despite `_` wildcard in OLD_ID (`legacy_bot`).
    expect(db.query('SELECT id, message_id FROM thread_files WHERE sender = ?').get(DECOY_ID)).toEqual({ id: `${DECOY_ID}:dreq-1:0`, message_id: `${DECOY_ID}:dreq-1` })
    expect(db.query('SELECT id FROM work_answers ORDER BY id').all()).toEqual([{ id: `check-${newCheck}` }, { id: `drop-${newMember}` }])
    expect(db.query('SELECT id, verdict_request FROM work_checks WHERE item_id = ?').get(newMember)).toEqual({ id: newCheck, verdict_request: `verdict-${newCheck}` })
    expect(db.query("SELECT target FROM system_changes WHERE tool = 'lilbot_work'").get()).toEqual({ target: newMember })
    expect(db.query('SELECT chat_id, event_key FROM activity_cursors WHERE bot_id = ? ORDER BY chat_id').all(newId)).toEqual([
      { chat_id: 'chat-main-1', event_key: 'evt-1' },
      { chat_id: `check:${newCheck}`, event_key: `${newCheck}:1:1000` },
      { chat_id: `thread:${newId}:wreq-1`, event_key: `${newId}:wreq-1:1:1000` },
      { chat_id: `work:${newMember}`, event_key: 'ask-1' }
    ])
    const refRow = db.query<{ id: string; item: string }, [string]>('SELECT id, item FROM history_items WHERE bot = ?').get(OTHER_ID)!
    expect(refRow.id).toBe(`work:${newMember}`)
    expect(JSON.parse(refRow.item)).toMatchObject({ toolId: `work:${newMember}`, workItemId: newMember })
    const expectedAvatar = defaultAvatar(OLD_ID)
    expect(db.query('SELECT avatar_shape, avatar_color, avatar_face_color, main_chat_id FROM bot_prefs WHERE bot_id = ?').get(newId)).toEqual({
      avatar_shape: expectedAvatar.shape,
      avatar_color: expectedAvatar.color,
      avatar_face_color: expectedAvatar.faceColor,
      main_chat_id: null
    })
    db.close()

    const mem = JSON.parse(readFileSync(join(f.profileDir, 'lilbot-memory.json'), 'utf8'))
    expect(mem.bot_id).toBe(newId)
    expect(mem.creation_capability).toBe(createHmac('sha256', SECRET_TOKEN).update(`create-bot:${newId}`).digest('hex'))

    // Idempotent second run.
    const again = await runRekey({ from: OLD_ID, to: newId, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: true, dryRun: false })
    expect(again.mode).toBe('already-rekeyed')
    expect(again.totalChanges).toBe(0)

    // Full `--undo` restores DB, computer key, workspace/archive folders, and Hermes files (including .env & lilbot-applied.json).
    const undoDry = await runUndo({ undo: applied.backupDir!, dryRun: true })
    expect(undoDry.restored).toBe(false)
    const undone = await runUndo({ undo: applied.backupDir!, dryRun: false })
    expect(undone.restored).toBe(true)
    expect(existsSync(join(f.workspacesDir, OLD_ID, 'note.txt'))).toBe(true)
    expect(existsSync(join(f.workspacesDir, newId))).toBe(false)
    expect(existsSync(join(f.workspacesDir, '.archive', OLD_ID, 'old.txt'))).toBe(true)
    expect(existsSync(join(f.profileDir, 'lilbot-applied.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(f.profileDir, 'lilbot-memory.json'), 'utf8')).bot_id).toBe(OLD_ID)
    expect(readFileSync(join(f.profileDir, '.env'), 'utf8')).toBe(SECRET_ENV)
    expect(readFileSync(join(f.dataDir, 'computer-server-key.pem'), 'utf8')).toBe(`${SECRET_KEY}\n`)
    const restoredDb = new Database(f.dbPath, { readonly: true })
    expect(restoredDb.query('SELECT id FROM bots WHERE id = ?').get(OLD_ID)).toBeTruthy()
    expect(restoredDb.query('SELECT id FROM bots WHERE id = ?').get(newId)).toBeNull()
    restoredDb.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
