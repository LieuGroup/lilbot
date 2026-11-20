/** LilBot owns bot identity, engine bindings, preferences and memory. Conversation records also live here; engines own working context. */
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { migrations } from './migrations'

/** `path` may be ':memory:' for tests. Applies any migration steps the file has not seen. */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const db = new Database(path, { create: true, strict: true })
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')

  const applied = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version
  if (applied > migrations.length) throw new Error(`The database is from a newer LilBot (schema ${applied}, this build knows ${migrations.length}).`)
  for (let step = applied; step < migrations.length; step++) {
    db.transaction(() => {
      db.exec(migrations[step])
      db.exec(`PRAGMA user_version = ${step + 1}`)
    })()
  }
  return db
}
