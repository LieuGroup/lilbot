/** `bun run history:exclude -- --bot <botId> --session <sessionId> --reason "<text>" [--yes]`: removes one engine
 *  session from LilBot's conversation copy for good (Hermes keeps its transcript). Without `--yes` it only prints
 *  what would go. Environment: `LILBOT_DATA_DIR` (default: production's data folder). Run it only after a deploy
 *  that includes the exclusion migration; it never migrates or creates the database. */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { excludeSession, previewExclusion } from './history-exclusion'

const argument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index > 0 ? process.argv[index + 1] : undefined
}
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const bot = argument('--bot')
const session = argument('--session')
const reason = argument('--reason')?.trim()
if (!bot || !session || !reason) fail('Usage: bun run history:exclude -- --bot <botId> --session <sessionId> --reason "<text>" [--yes]')
const path = join(process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local', 'share', 'lilbot'), 'lilbot.db')
if (!existsSync(path)) fail(`No LilBot database at ${path}.`)

const db = new Database(path, { create: false, strict: true })
try {
  db.exec('PRAGMA busy_timeout = 5000')
  if (!db.query("SELECT 1 FROM sqlite_master WHERE name='history_exclusions'").get()) fail('This database has no history_exclusions table: deploy the version that adds it first.')
  const preview = previewExclusion(db, bot as string, session as string)
  console.log(`Database: ${path}\nBot: ${bot}\nSession: ${session}`)
  if (preview.already) {
    console.log('Already excluded; nothing to remove.')
  } else {
    console.log(
      `Would remove: ${
        Object.entries(preview.kinds)
          .map(([kind, n]) => `${n} ${kind}`)
          .join(', ') || 'no rows'
      }, ${preview.events} journal events.`
    )
    for (const sample of preview.samples) console.log(`  ${sample.kind}: ${sample.text}`)
    if (!process.argv.includes('--yes')) console.log('Dry run. Add --yes to apply.')
    else console.log(excludeSession(db, bot as string, session as string, reason as string) ? 'Excluded.' : 'Already excluded; nothing to remove.')
  }
} catch (error) {
  fail(error instanceof Error ? error.message : 'Exclusion failed.')
} finally {
  db.close()
}
