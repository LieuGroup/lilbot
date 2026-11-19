import '../scripts/dev-env'
/** Run only on a disposable copy (including WAL/SHM) of the live database. Never opens the live file. */
import { Database } from 'bun:sqlite'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BotRuntimes } from '../server/bots/bot-runtimes'
import { BotStore } from '../server/bots/bot-store'
import { openDatabase } from '../server/database/database'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'

const directory = process.argv[2]
if (!directory || !realpathSync(directory).startsWith(`${realpathSync(join(homedir(), 'lilbot-dev', 'runs'))}/`)) {
  throw new Error('Pass a disposable database copy under ~/lilbot-dev/runs, including WAL/SHM.')
}
const path = join(directory, 'lilbot.db')
const tables = ['bot_prefs', 'primary_bot', 'memory_facts', 'sections', 'review_turns', 'bot_activity', 'activity_cursors']
const beforeDb = new Database(path, { readonly: true })
const version = beforeDb.query('PRAGMA user_version').get()
const before = tables.map(table => beforeDb.query(`SELECT * FROM ${table} ORDER BY rowid`).all())
beforeDb.close()
const db = openDatabase(path)
const store = new BotStore(db)
await new BotRuntimes(store, new HermesEngine()).initialize()
for (let i = 0; i < tables.length; i++) {
  const after = db.query(`SELECT * FROM ${tables[i]} ORDER BY rowid`).all()
  if (JSON.stringify(after) !== JSON.stringify(before[i])) throw new Error(`${tables[i]} changed during the upgrade`)
  console.log(`ok ${tables[i]}: ${after.length} rows unchanged`)
}
console.log(`ok schema ${JSON.stringify(version)} -> ${JSON.stringify(db.query('PRAGMA user_version').get())}; ${store.list().length} identities imported`)
db.close()
process.exit(0)
