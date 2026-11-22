import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCli } from '../../scripts/rekey/rekey-cli'
import { runRekey } from '../../scripts/rekey-bot'
import { MAINTENANCE_LOCK_FILE } from '../../server/deploy/maintenance'
import { createRekeyFixture, OLD_ID, OTHER_ID } from './rekey-fixture'

test('CLI refuses unknown flags, --force without --undo, and missing explicit paths (no production defaults)', () => {
  expect(() => parseCli(['--from', OLD_ID, '--unknown'])).toThrow('Unknown argument')
  expect(() => parseCli(['--from', OLD_ID])).toThrow('no production defaults')
  expect(() => parseCli(['--from', OLD_ID, '--data-dir', '/tmp/d'])).toThrow('--workspaces-dir')
  expect(() => parseCli(['--from', OLD_ID, '--data-dir', '/tmp/d', '--skip-workspaces'])).toThrow('--hermes-home')
  expect(() => parseCli(['--from', OLD_ID, '--data-dir', '/tmp/d', '--skip-workspaces', '--skip-hermes', '--force'])).toThrow('--force is only valid with --undo')
  expect(parseCli(['--undo', '/tmp/b', '--force', '--yes'])).toEqual({ undo: '/tmp/b', dryRun: false, force: true })
  expect(parseCli(['--from', OLD_ID, '--data-dir', '/tmp/d', '--skip-workspaces', '--skip-hermes'])).toMatchObject({ workspacesDir: null, hermesHome: null, dryRun: true })
})

test('pre-flight refuses missing dirs, dangling symlinks, corrupt JSON, read-only dirs/files, non-dir workspace, and low disk space before touching anything', async () => {
  type Fix = ReturnType<typeof createRekeyFixture>
  const cases: Array<[string, (f: Fix) => Partial<Parameters<typeof runRekey>[0]> | undefined, string]> = [
    ['missing workspaces dir', f => ({ workspacesDir: join(f.dataDir, 'missing-ws') }), 'workspaces directory does not exist'],
    ['missing hermes home', f => ({ hermesHome: join(f.dataDir, 'missing-h') }), 'Hermes home directory does not exist'],
    [
      'dangling workspace symlink',
      f => {
        symlinkSync('/nonexistent/target', join(f.workspacesDir, 'target-uuid'))
        return { to: 'target-uuid' }
      },
      'symlink at new workspace'
    ],
    [
      'dangling Hermes symlink',
      f => {
        rmSync(join(f.profileDir, 'lilbot-skills.json'))
        symlinkSync('/nonexistent/skills', join(f.profileDir, 'lilbot-skills.json'))
        return undefined
      },
      'symlink at lilbot-skills.json'
    ],
    [
      'corrupt JSON',
      f => {
        writeFileSync(join(f.profileDir, 'lilbot-memory.json'), '{bad-json')
        return undefined
      },
      'invalid JSON'
    ],
    [
      'read-only JSON',
      f => {
        chmodSync(join(f.profileDir, 'lilbot-computers.json'), 0o400)
        return undefined
      },
      'not readable and writable'
    ],
    [
      'read-only rekey-backups dir',
      f => {
        mkdirSync(join(f.dataDir, 'rekey-backups'), { mode: 0o500 })
        return { dryRun: true }
      },
      'rekey-backups directory is not readable and writable'
    ],
    [
      'unreadable Hermes .env',
      f => {
        chmodSync(join(f.profileDir, '.env'), 0o000)
        return { dryRun: true }
      },
      '.env is not readable'
    ],
    [
      'regular file at workspaces/<oldId>',
      f => {
        rmSync(join(f.workspacesDir, OLD_ID), { recursive: true, force: true })
        writeFileSync(join(f.workspacesDir, OLD_ID), 'not-a-dir')
        return { dryRun: true }
      },
      'old workspace is not a directory'
    ],
    [
      'symlinked computer-server-key.pem',
      f => {
        rmSync(join(f.dataDir, 'computer-server-key.pem'))
        symlinkSync('/nonexistent/key.pem', join(f.dataDir, 'computer-server-key.pem'))
        return { dryRun: true }
      },
      'symlink at computer-server-key.pem'
    ],
    [
      'symlinked rekey-journal.json',
      f => {
        symlinkSync('/nonexistent/journal.json', join(f.dataDir, 'rekey-journal.json'))
        return { dryRun: true }
      },
      'non-regular rekey journal'
    ],
    ['low free space', () => ({ testHooks: { minDataBytes: Number.MAX_SAFE_INTEGER } }), 'Insufficient free disk space']
  ]
  for (const [name, mutate, match] of cases) {
    const root = mkdtempSync(join(tmpdir(), 'rekey-pre-'))
    try {
      const f = createRekeyFixture(root)
      await expect(
        runRekey({ from: OLD_ID, dataDir: f.dataDir, workspacesDir: f.workspacesDir, hermesHome: f.hermesHome, clearMainChat: false, dryRun: false, ...(mutate(f) ?? {}) }),
        name
      ).rejects.toThrow(match)
      const db = new Database(f.dbPath, { readonly: true })
      expect(db.query('SELECT id FROM bots WHERE id = ?').get(OLD_ID)).toBeTruthy()
      db.close()
      expect(existsSync(join(f.workspacesDir, OLD_ID))).toBe(true)
    } finally {
      try {
        chmodSync(join(root, 'data', 'rekey-backups'), 0o700)
      } catch {}
      try {
        chmodSync(join(root, 'hermes', 'profiles', OLD_ID, '.env'), 0o600)
        chmodSync(join(root, 'hermes', 'profiles', OLD_ID, 'lilbot-computers.json'), 0o600)
      } catch {}
      rmSync(root, { recursive: true, force: true })
    }
  }
}, 45_000)

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
