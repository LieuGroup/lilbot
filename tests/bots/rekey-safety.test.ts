import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCli } from '../../scripts/rekey/rekey-cli'
import type { FailurePoint } from '../../scripts/rekey/rekey-disk'
import { readJournal } from '../../scripts/rekey/rekey-journal'
import { runRekey } from '../../scripts/rekey-bot'
import { MAINTENANCE_LOCK_FILE } from '../../server/deploy/maintenance'
import { createRekeyFixture, OLD_ID, OTHER_ID } from './rekey-fixture'

test('CLI refuses unknown flags and missing explicit paths (no production defaults)', () => {
  expect(() => parseCli(['--from', OLD_ID, '--unknown'])).toThrow('Unknown argument')
  expect(() => parseCli(['--from', OLD_ID])).toThrow('no production defaults')
  expect(() => parseCli(['--from', OLD_ID, '--data-dir', '/tmp/d'])).toThrow('--workspaces-dir')
  expect(() => parseCli(['--from', OLD_ID, '--data-dir', '/tmp/d', '--skip-workspaces'])).toThrow('--hermes-home')
  expect(parseCli(['--from', OLD_ID, '--data-dir', '/tmp/d', '--skip-workspaces', '--skip-hermes'])).toMatchObject({ workspacesDir: null, hermesHome: null, dryRun: true })
})

test('pre-flight refuses missing dirs, dangling symlinks, corrupt JSON, read-only files, and low disk space before touching anything', async () => {
  const cases: Array<{ name: string; mutate: (f: ReturnType<typeof createRekeyFixture>) => Partial<Parameters<typeof runRekey>[0]>; match: string }> = [
    { name: 'missing workspaces dir', mutate: f => ({ workspacesDir: join(f.dataDir, 'missing-ws') }), match: 'workspaces directory does not exist' },
    { name: 'missing hermes home', mutate: f => ({ hermesHome: join(f.dataDir, 'missing-h') }), match: 'Hermes home directory does not exist' },
    {
      name: 'dangling symlink at new workspace',
      mutate: f => {
        symlinkSync('/nonexistent/target', join(f.workspacesDir, 'target-uuid'))
        return { to: 'target-uuid' }
      },
      match: 'symlink at new workspace'
    },
    {
      name: 'dangling symlink at Hermes file',
      mutate: f => {
        rmSync(join(f.profileDir, 'lilbot-skills.json'))
        symlinkSync('/nonexistent/skills', join(f.profileDir, 'lilbot-skills.json'))
        return {}
      },
      match: 'symlink at lilbot-skills.json'
    },
    {
      name: 'corrupt JSON in lilbot-memory.json',
      mutate: f => {
        writeFileSync(join(f.profileDir, 'lilbot-memory.json'), '{bad-json')
        return {}
      },
      match: 'invalid JSON'
    },
    {
      name: 'read-only Hermes JSON file',
      mutate: f => {
        chmodSync(join(f.profileDir, 'lilbot-computers.json'), 0o400)
        return {}
      },
      match: 'not readable and writable'
    },
    { name: 'insufficient free space', mutate: () => ({ testHooks: { minDataBytes: Number.MAX_SAFE_INTEGER } }), match: 'Insufficient free disk space' }
  ]
  for (const c of cases) {
    const root = mkdtempSync(join(tmpdir(), 'rekey-pre-'))
    try {
      const f = createRekeyFixture(root)
      const override = c.mutate(f)
      await expect(
        runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: false, dryRun: false, ...override }),
        c.name
      ).rejects.toThrow(c.match)
      // Verify untouched state.
      const db = new Database(f.dbPath, { readonly: true })
      expect(db.query('SELECT id FROM bots WHERE id = ?').get(OLD_ID)).toBeTruthy()
      db.close()
      expect(existsSync(join(f.workspacesDir, OLD_ID))).toBe(true)
    } finally {
      chmodSync(join(root, 'hermes', 'profiles', OLD_ID, 'lilbot-computers.json'), 0o600)
      rmSync(root, { recursive: true, force: true })
    }
  }
}, 30_000)

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

test('refuses wrong target, deleted bot, all 6 in-flight work tables, non-stopped service, deploy lock, and open DB process', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rekey-refuse-'))
  try {
    const f = createRekeyFixture(root)
    const base = { from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: false, dryRun: false }

    // --from <missing> --to <existing second bot>
    await expect(runRekey({ ...base, from: 'nonexistent-bot', to: OTHER_ID })).rejects.toThrow('belongs to a different bot')

    // Non-stopped systemd service state (deactivating, activating, failed)
    for (const active of ['active', 'activating', 'deactivating', 'failed']) {
      await expect(
        runRekey({
          ...base,
          testHooks: { serviceProbe: () => ({ exitCode: 0, stdout: `LoadState=loaded\nActiveState=${active}\nSubState=running\nEnvironment=LILBOT_DATA_DIR=${f.dataDir}\n` }) }
        })
      ).rejects.toThrow(`lilbot.service is ${active}/running`)
    }

    // Non-maintenance deploy lock refused; maintenance lock allowed
    const lockDir = join(f.dataDir, 'deploy', 'lock')
    mkdirSync(lockDir, { recursive: true })
    await expect(runRekey(base)).rejects.toThrow('deployment lock exists')
    writeFileSync(join(lockDir, MAINTENANCE_LOCK_FILE), JSON.stringify({ startedAt: new Date().toISOString(), unit: 'lilbot.service', dataDir: f.dataDir }))
    expect((await runRekey({ ...base, dryRun: true })).mode).toBe('dry-run')
    rmSync(lockDir, { recursive: true, force: true })

    // All 6 in-flight work tables refused with counts only
    const db = new Database(f.dbPath)
    db.query("UPDATE computer_requests SET status = 'running' WHERE id = 'cr-1'").run()
    db.query("UPDATE routine_runs SET status = 'pending' WHERE id = 'rr-1'").run()
    db.query("UPDATE webhook_runs SET status = 'running' WHERE id = 'wr-1'").run()
    db.query("UPDATE thread_deliveries SET status = 'pending' WHERE sender = ?").run(OLD_ID)
    db.query("UPDATE work_answers SET status = 'stopping' WHERE bot_id = ?").run(OLD_ID)
    db.query("UPDATE work_checks SET state = 'checking' WHERE checker_id = ?").run(OLD_ID)
    db.close()
    await expect(runRekey(base)).rejects.toThrow(/computer_requests=1.*routine_runs=1.*webhook_runs=1.*thread_deliveries=2.*work_answers=2.*work_checks=1/)

    // Deleted (tombstoned) bot refused
    const db2 = new Database(f.dbPath)
    db2.query('UPDATE bots SET deletion = \'{"complete":true}\' WHERE id = ?').run(OLD_ID)
    db2.close()
    await expect(runRekey(base)).rejects.toThrow('deleted (tombstoned)')

    // Active process holding lilbot.db open refused
    const holder = Bun.spawn([
      'bun',
      '-e',
      `import { Database } from 'bun:sqlite'; const db = new Database(${JSON.stringify(f.dbPath)}); db.query('SELECT 1').get(); await Bun.sleep(10000);`
    ])
    try {
      await Bun.sleep(250)
      await expect(runRekey(base)).rejects.toThrow('currently has this database open')
    } finally {
      holder.kill()
      await holder.exited
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
