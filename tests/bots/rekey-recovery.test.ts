import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FailurePoint } from '../../scripts/rekey/rekey-disk'
import { readJournal } from '../../scripts/rekey/rekey-journal'
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
}, 30_000)

test('journal pins the chosen random target id across a mid-run crash and resumes without --to', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-crash-'))
  try {
    const f = createRekeyFixture(root)
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

    const journal = readJournal(f.dataDir)
    expect(journal?.from).toBe(OLD_ID)
    expect(journal?.steps.db).toBe(true)
    expect(journal?.steps.workspace).toBe(true)
    expect(journal?.steps.hermes).toBe(false)
    // Re-running without --to reuses journal.to instead of minting a fresh UUID.
    const resumed = await runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: true, dryRun: false })
    expect(resumed.to).toBe(journal!.to)
    expect(resumed.disk.workspace).toBe('already-moved')
    expect(resumed.disk.hermes['lilbot-skills.json']).toBe('updated')
    expect(readJournal(f.dataDir)).toBeNull()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
