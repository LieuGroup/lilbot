import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FailurePoint } from '../../scripts/rekey/rekey-disk'
import { journalPath, readJournal, writeJournal } from '../../scripts/rekey/rekey-journal'
import { runRekey } from '../../scripts/rekey-bot'
import { createRekeyFixture, OLD_ID } from './rekey-fixture'

test('failure at every post-DB step rolls back DB, folders, and Hermes files cleanly with zero split state', async () => {
  const points: FailurePoint[] = ['post-db', 'workspace', 'archive', 'hermes-memory', 'hermes-skills', 'hermes-computers', 'hermes-applied']
  for (const point of points) {
    const root = mkdtempSync(join(tmpdir(), `rekey-fail-${point}-`))
    try {
      const f = createRekeyFixture(root)
      await expect(
        runRekey({
          from: OLD_ID,
          to: 'target-fail-id',
          dataDir: f.dataDir,
          workspacesDir: f.workspacesDir,
          hermesHome: f.hermesHome,
          clearMainChat: true,
          dryRun: false,
          testHooks: { injectFailure: point }
        })
      ).rejects.toThrow(`Injected failure at ${point}`)

      expect(readJournal(f.dataDir)).toBeNull()
      expect(existsSync(join(f.workspacesDir, OLD_ID, 'note.txt'))).toBe(true)
      expect(existsSync(join(f.workspacesDir, 'target-fail-id'))).toBe(false)
      expect(existsSync(join(f.workspacesDir, '.archive', OLD_ID, 'old.txt'))).toBe(true)
      expect(JSON.parse(readFileSync(join(f.profileDir, 'lilbot-memory.json'), 'utf8')).bot_id).toBe(OLD_ID)
      expect(JSON.parse(readFileSync(join(f.profileDir, 'lilbot-skills.json'), 'utf8')).botId).toBe(OLD_ID)
      expect(existsSync(join(f.profileDir, 'lilbot-applied.json'))).toBe(true)
      const db = new Database(f.dbPath, { readonly: true })
      expect(db.query('SELECT id FROM bots WHERE id = ?').get(OLD_ID)).toBeTruthy()
      expect(db.query('SELECT id FROM bots WHERE id = ?').get('target-fail-id')).toBeNull()
      db.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}, 45_000)

test('journal pins target id across mid-run crash, blocks skipped-disk resume, replaces dead backupDir, and refuses corrupt JSON cleanly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-crash-'))
  try {
    const f = createRekeyFixture(root)

    // Corrupt / truncated / null / missing-steps journals throw clean refusal (never raw SyntaxError / TypeError).
    for (const payload of ['{truncated', 'null', '[]', JSON.stringify({ version: 1, from: OLD_ID, to: 'x', backupDir: '/tmp/b' })]) {
      writeFileSync(journalPath(f.dataDir), payload)
      expect(() => readJournal(f.dataDir)).toThrow('Corrupt rekey journal')
      await expect(runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: false, dryRun: true })).rejects.toThrow(
        'Corrupt rekey journal'
      )
    }
    rmSync(journalPath(f.dataDir))

    // Dead backupDir while DB still at oldId: resume creates a fresh backup and persists it into journal (rollback works too!).
    const deadBackup = join(f.dataDir, 'rekey-backups', 'deleted-dir')
    writeJournal(f.dataDir, {
      version: 1,
      mode: 'rekey',
      from: OLD_ID,
      to: 'pinned-uuid-1',
      engineBotId: OLD_ID,
      backupDir: deadBackup,
      dataDir: f.dataDir,
      workspacesDir: f.workspacesDir,
      hermesHome: f.hermesHome,
      clearMainChat: true,
      steps: { backup: true, db: false, workspace: false, archive: false, hermes: false }
    })
    await expect(
      runRekey({
        from: OLD_ID,
        dataDir: f.dataDir,
        workspacesDir: f.workspacesDir,
        hermesHome: f.hermesHome,
        clearMainChat: true,
        dryRun: false,
        testHooks: { injectFailure: 'hermes-skills', simulateCrash: true }
      })
    ).rejects.toThrow('Injected failure at hermes-skills')

    const journal = readJournal(f.dataDir)!
    expect(journal.to).toBe('pinned-uuid-1')
    expect(journal.backupDir).not.toBe(deadBackup)
    expect(existsSync(join(journal.backupDir, 'lilbot.db'))).toBe(true)
    expect(journal.steps.db).toBe(true)
    expect(journal.steps.workspace).toBe(true)
    expect(journal.steps.hermes).toBe(false)

    // Resuming with --skip-workspaces or --skip-hermes MUST refuse and keep journal intact.
    await expect(runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: null, hermesHome: null, clearMainChat: true, dryRun: false })).rejects.toThrow(
      'cannot resume with --skip-workspaces'
    )
    await expect(runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: null, clearMainChat: true, dryRun: false })).rejects.toThrow(
      'cannot resume with --skip-hermes'
    )
    expect(readJournal(f.dataDir)).not.toBeNull()

    // Re-running with matching flags without --to finishes cleanly with the same pinned UUID.
    const resumed = await runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: true, dryRun: false })
    expect(resumed.to).toBe('pinned-uuid-1')
    expect(resumed.disk.workspace).toBe('already-moved')
    expect(resumed.disk.hermes['lilbot-skills.json']).toBe('updated')
    expect(readJournal(f.dataDir)).toBeNull()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test('SIGKILL mid-run across post-db, workspace, and hermes-skills recovers cleanly via rerun or --undo', async () => {
  const { runUndo } = await import('../../scripts/rekey-bot')
  const repo = join(import.meta.dir, '../..')
  for (const point of ['post-db', 'workspace', 'hermes-skills'] as const) {
    for (const recovery of ['rerun', 'undo'] as const) {
      const root = mkdtempSync(join(tmpdir(), `rekey-kill-${point}-${recovery}-`))
      try {
        const f = createRekeyFixture(root)
        const code = `
          import { runRekey } from './scripts/rekey-bot.ts';
          await runRekey({ from: ${JSON.stringify(OLD_ID)}, dataDir: ${JSON.stringify(f.dataDir)}, workspacesDir: ${JSON.stringify(f.workspacesDir)}, hermesHome: ${JSON.stringify(f.hermesHome)}, clearMainChat: true, dryRun: false, testHooks: { injectFailure: ${JSON.stringify(point)}, simulateCrash: true } }).catch(() => {});
          console.log('READY_KILL'); await Bun.sleep(60000);
        `
        const proc = Bun.spawn(['bun', '-e', code], { cwd: repo, stdout: 'pipe', stderr: 'pipe' })
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
        const journal = readJournal(f.dataDir)!
        expect(journal.mode).toBe('rekey')
        if (recovery === 'rerun') {
          const done = await runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: true, dryRun: false })
          expect(done.to).toBe(journal.to)
          expect(existsSync(join(f.workspacesDir, journal.to, 'note.txt'))).toBe(true)
        } else {
          const undone = await runUndo({ undo: journal.backupDir, dryRun: false })
          expect(undone.restored).toBe(true)
          expect(existsSync(join(f.workspacesDir, OLD_ID, 'note.txt'))).toBe(true)
        }
        expect(readJournal(f.dataDir)).toBeNull()
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  }
}, 45_000)
