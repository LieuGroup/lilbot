/** Process-safety guard and atomic SQLite rollback backup for bot re-keying. Never logs secrets. */
import type { Database } from 'bun:sqlite'
import { chmodSync, existsSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Refuses if `lilbot.service` is active against `dataDir` or any other local process currently holds `lilbot.db` open. */
export function assertDatabaseNotInUse(dataDir: string) {
  const resolvedData = resolve(dataDir)
  const dbPath = resolve(resolvedData, 'lilbot.db')

  const active = Bun.spawnSync(['systemctl', '--user', 'show', '-p', 'ActiveState,Environment', 'lilbot.service'], { stdout: 'pipe', stderr: 'ignore' })
  if (active.exitCode === 0) {
    const out = active.stdout.toString()
    if (/^ActiveState=active$/m.test(out)) {
      const envMatch = /LILBOT_DATA_DIR=(\S+)/.exec(out)
      const serviceDataDir = resolve(envMatch?.[1] ?? join(homedir(), '.local', 'share', 'lilbot'))
      if (serviceDataDir === resolvedData) {
        throw new Error('Refusing to run: lilbot.service is active against this data directory. Stop lilbot.service first.')
      }
    }
  }

  if (!existsSync('/proc')) return
  const targets = new Set([dbPath, `${dbPath}-wal`, `${dbPath}-shm`])
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    if (pid === process.pid) continue
    let fds: string[]
    try {
      fds = readdirSync(`/proc/${pid}/fd`)
    } catch {
      continue
    }
    for (const fd of fds) {
      let target: string
      try {
        target = readlinkSync(`/proc/${pid}/fd/${fd}`)
      } catch {
        continue
      }
      if (!targets.has(target)) continue
      let comm = 'process'
      try {
        comm = readFileSync(`/proc/${pid}/comm`, 'utf8').trim() || comm
      } catch {}
      throw new Error(`Refusing to run: ${comm} (pid ${pid}) currently has this database open. Stop it first.`)
    }
  }
}

/** Creates an atomic self-contained SQLite copy via `VACUUM INTO` for automatic rollback if workspace rename fails. */
export function backupForRollback(db: Database, backupPath: string) {
  rmSync(backupPath, { force: true })
  db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`)
  chmodSync(backupPath, 0o600)
}

export function restoreFromBackup(backupPath: string, dbPath: string) {
  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
  renameSync(backupPath, dbPath)
  chmodSync(dbPath, 0o600)
}
