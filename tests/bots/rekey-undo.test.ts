import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJournal } from '../../scripts/rekey/rekey-journal'
import type { UndoFailurePoint } from '../../scripts/rekey/rekey-undo'
import { runRekey, runUndo } from '../../scripts/rekey-bot'
import { createRekeyFixture, OLD_ID } from './rekey-fixture'

const REPO = join(import.meta.dir, '../..')

test('--undo refuses post-rekey writes without --force (reporting counts only), allows --force, and refuses repeated --undo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-undo-post-'))
  try {
    const f = createRekeyFixture(root)
    const newId = 'new-id-undo-1'
    const applied = await runRekey({ from: OLD_ID, to: newId, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: true, dryRun: false })
    const backupDir = applied.backupDir!

    // Simulate app starting after re-key and writing a new memory fact under newId.
    const db = new Database(f.dbPath)
    db.query("INSERT INTO memory_facts(id, bot_id, kind, scope, text, author, learned_at) VALUES ('post-1', ?, 'profile', 'bot', 'SECRET_POST_REKEY_FACT', 'bot', 9999)").run(newId)
    db.close()

    // Without --force: refused (even in dry-run), reports table + count delta, never leaks fact text, mutates nothing.
    let errMsg = ''
    try {
      await runUndo({ undo: backupDir, dryRun: false })
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e)
    }
    expect(errMsg).toContain('memory_facts (+1 rows)')
    expect(errMsg).not.toContain('SECRET_POST_REKEY_FACT')
    await expect(runUndo({ undo: backupDir, dryRun: true })).rejects.toThrow('memory_facts (+1 rows)')

    // With --force: restores pre-rekey state cleanly.
    const forced = await runUndo({ undo: backupDir, dryRun: false, force: true })
    expect(forced.restored).toBe(true)
    expect(forced.postRekeyChanges.map(d => d.table)).toContain('memory_facts')

    // Write post-undo fact under oldId; repeated --undo MUST refuse even with --force and preserve post-undo fact.
    const db2 = new Database(f.dbPath)
    db2.query("INSERT INTO memory_facts(id, bot_id, kind, scope, text, author, learned_at) VALUES ('after-undo-1', ?, 'profile', 'bot', 'keep-me', 'bot', 9999)").run(OLD_ID)
    db2.close()
    await expect(runUndo({ undo: backupDir, dryRun: false })).rejects.toThrow('already present')
    await expect(runUndo({ undo: backupDir, dryRun: false, force: true })).rejects.toThrow('already present')
    const check = new Database(f.dbPath, { readonly: true })
    expect(check.query("SELECT id FROM memory_facts WHERE id = 'after-undo-1'").get()).toBeTruthy()
    check.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test('--undo refuses stale earlier backup (old->A->B), missing workspace, incomplete/tampered backup, and preserves post-created .env', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-undo-stale-'))
  try {
    const f = createRekeyFixture(root)
    // Remove .env BEFORE backup so it was absent at re-key time.
    rmSync(join(f.profileDir, '.env'))
    const r1 = await runRekey({ from: OLD_ID, to: 'id-stage-a', dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: false, dryRun: false })
    const r2 = await runRekey({
      from: 'id-stage-a',
      to: 'id-stage-b',
      dataDir: f.dataDir,
      workspacesDir: f.workspacesDir,
      hermesHome: f.hermesHome,
      clearMainChat: false,
      dryRun: false
    })

    // Stale backup (old -> A) while live DB & workspace are at B MUST refuse (even with --force).
    await expect(runUndo({ undo: r1.backupDir!, dryRun: false })).rejects.toThrow('stale backup')
    await expect(runUndo({ undo: r1.backupDir!, dryRun: false, force: true })).rejects.toThrow('stale backup')
    expect(existsSync(join(f.workspacesDir, 'id-stage-b'))).toBe(true)

    // Incomplete backup (delete hermes/lilbot-skills.json from r2) MUST fail BOTH dry-run and apply with zero Hermes mutation.
    const savedSkillBak = readFileSync(join(r2.backupDir!, 'hermes', 'lilbot-skills.json'))
    rmSync(join(r2.backupDir!, 'hermes', 'lilbot-skills.json'))
    await expect(runUndo({ undo: r2.backupDir!, dryRun: true })).rejects.toThrow('lilbot-skills.json')
    await expect(runUndo({ undo: r2.backupDir!, dryRun: false })).rejects.toThrow('lilbot-skills.json')
    expect(JSON.parse(readFileSync(join(f.profileDir, 'lilbot-memory.json'), 'utf8')).bot_id).toBe('id-stage-b')
    writeFileSync(join(r2.backupDir!, 'hermes', 'lilbot-skills.json'), savedSkillBak)

    // Create .env AFTER backup; undoing r2 then r1 must keep the post-created .env intact!
    writeFileSync(join(f.profileDir, '.env'), 'POST_CREATED_ENV=1\n', { mode: 0o600 })
    expect((await runUndo({ undo: r2.backupDir!, dryRun: false })).restored).toBe(true)
    expect((await runUndo({ undo: r1.backupDir!, dryRun: false })).restored).toBe(true)
    expect(readFileSync(join(f.profileDir, '.env'), 'utf8')).toBe('POST_CREATED_ENV=1\n')
    expect(existsSync(join(f.workspacesDir, OLD_ID))).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test('SIGKILL at every --undo stage leaves mode=undo journal, blocks forward re-key, and completes cleanly on rerun', async () => {
  const stages: UndoFailurePoint[] = ['undo-hermes', 'undo-workspace', 'undo-archive', 'undo-db', 'undo-key']
  for (const stage of stages) {
    const root = mkdtempSync(join(tmpdir(), `rekey-undo-kill-${stage}-`))
    try {
      const f = createRekeyFixture(root)
      const applied = await runRekey({
        from: OLD_ID,
        to: 'undo-kill-target',
        dataDir: f.dataDir,
        workspacesDir: f.workspacesDir,
        hermesHome: f.hermesHome,
        clearMainChat: false,
        dryRun: false
      })
      const backupDir = applied.backupDir!

      // Spawn a real subprocess that pauses right at `stage` so we can deliver real SIGKILL.
      const code = `
        import { restoreRekeyBackup } from './scripts/rekey/rekey-undo.ts';
        const err = await restoreRekeyBackup(${JSON.stringify(backupDir)}, { dryRun: false, injectFailure: ${JSON.stringify(stage)} }).catch(e => e);
        if (err instanceof Error && err.message.includes('Injected failure')) { console.log('READY_KILL'); await Bun.sleep(60000); }
        process.exit(2);
      `
      const proc = Bun.spawn(['bun', '-e', code], { cwd: REPO, stdout: 'pipe', stderr: 'pipe' })
      const reader = proc.stdout.getReader()
      let out = ''
      while (!out.includes('READY_KILL')) {
        const { value, done } = await reader.read()
        if (done) break
        out += new TextDecoder().decode(value)
      }
      expect(out).toContain('READY_KILL')
      proc.kill('SIGKILL')
      await proc.exited

      // Journal is present in undo mode, and forward re-key refuses until undo finishes.
      expect(readJournal(f.dataDir)?.mode).toBe('undo')
      await expect(runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: false, dryRun: false })).rejects.toThrow(
        'Unfinished undo in progress'
      )

      // Re-running --undo finishes cleanly to exact pre-rekey state.
      const resumed = await runUndo({ undo: backupDir, dryRun: false })
      expect(resumed.restored).toBe(true)
      expect(readJournal(f.dataDir)).toBeNull()
      expect(existsSync(join(f.workspacesDir, OLD_ID, 'note.txt'))).toBe(true)
      expect(existsSync(join(f.workspacesDir, 'undo-kill-target'))).toBe(false)
      expect(JSON.parse(readFileSync(join(f.profileDir, 'lilbot-memory.json'), 'utf8')).bot_id).toBe(OLD_ID)
      const db = new Database(f.dbPath, { readonly: true })
      expect(db.query('SELECT id FROM bots WHERE id = ?').get(OLD_ID)).toBeTruthy()
      expect(db.query('SELECT id FROM bots WHERE id = ?').get('undo-kill-target')).toBeNull()
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}, 30_000)
