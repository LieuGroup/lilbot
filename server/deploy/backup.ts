import { chmod, rename, rm } from 'node:fs/promises'
import { backup, DatabaseSync } from 'node:sqlite'

/** SQLite's online backup API includes committed WAL pages in one self-contained snapshot.
 * Never copy the live .db/-wal/-shm independently: they are one transaction state. */
export async function backupDatabase(source: string, target: string) {
  const db = new DatabaseSync(source, { readOnly: true })
  try {
    await backup(db, target)
  } finally {
    db.close()
  }
  await chmod(target, 0o600)
  const check = new DatabaseSync(target, { readOnly: true })
  try {
    if (check.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Database copy failed quick_check')
  } finally {
    check.close()
  }
}
/** Call only after systemd has stopped every service process. Credentials are never restored. */
export async function restoreDatabase(source: string, target: string) {
  const temporary = `${target}.restore`
  await rm(temporary, { force: true })
  await backupDatabase(source, temporary)
  await rm(`${target}-wal`, { force: true })
  await rm(`${target}-shm`, { force: true })
  await rename(temporary, target)
}
