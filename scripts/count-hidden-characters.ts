/** `bun scripts/count-hidden-characters.ts [path to lilbot.db]`: read-only count of stored memory facts that the shared
 *  safety rule (`memory-safety.ts`) refuses for DEL, C1 controls or variation selectors 17 and up. It copies the database
 *  with SQLite's online backup API into a private temporary folder, counts there, deletes the copy and prints only
 *  numbers, never fact text. The source is opened read-only and no fact is changed. */
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupDatabase } from '../server/deploy/backup'
import { CONTROLS, HIGH_VARIATION_SELECTORS } from '../server/memory/memory-safety'

const source = process.argv[2] ?? join(process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local', 'share', 'lilbot'), 'lilbot.db')
const folder = await mkdtemp(join(tmpdir(), 'lilbot-count-'))
try {
  const copy = join(folder, 'copy.db')
  await backupDatabase(source, copy)
  const db = new Database(copy, { readonly: true, strict: true })
  try {
    const counts = { facts: 0, kept: 0, controls: 0, highVariationSelectors: 0, either: 0, eitherKept: 0 }
    for (const row of db.query<{ text: string; forgotten_at: number | null }, []>('SELECT text, forgotten_at FROM memory_facts').iterate()) {
      const kept = row.forgotten_at === null
      const controls = CONTROLS.test(row.text)
      const selectors = HIGH_VARIATION_SELECTORS.test(row.text)
      counts.facts++
      if (kept) counts.kept++
      if (controls) counts.controls++
      if (selectors) counts.highVariationSelectors++
      if (controls || selectors) {
        counts.either++
        if (kept) counts.eitherKept++
      }
    }
    console.log(JSON.stringify(counts))
  } finally {
    db.close()
  }
} finally {
  await rm(folder, { recursive: true, force: true })
}
