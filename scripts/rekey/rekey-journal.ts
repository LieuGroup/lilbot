/** Durable journal for bot re-keying: records the chosen target id, backup dir, and completed steps for crash resume. */
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const JOURNAL_FILE = 'rekey-journal.json'

export interface RekeyJournal {
  version: 1
  from: string
  to: string
  engineBotId: string
  backupDir: string
  dataDir: string
  workspacesDir: string | null
  hermesHome: string | null
  clearMainChat: boolean
  steps: { backup: boolean; db: boolean; workspace: boolean; archive: boolean; hermes: boolean }
}

export function writeAtomicPrivate(path: string, content: string) {
  const tmp = `${path}.rekey-tmp-${process.pid}`
  writeFileSync(tmp, content, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}

const journalPath = (dataDir: string) => join(dataDir, JOURNAL_FILE)

export function readJournal(dataDir: string): RekeyJournal | null {
  const path = journalPath(dataDir)
  if (!existsSync(path)) return null
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RekeyJournal>
  if (parsed.version !== 1 || typeof parsed.from !== 'string' || typeof parsed.to !== 'string' || typeof parsed.backupDir !== 'string')
    throw new Error(`Corrupt rekey journal at ${path}; inspect before continuing.`)
  return parsed as RekeyJournal
}

export function writeJournal(dataDir: string, journal: RekeyJournal) {
  writeAtomicPrivate(journalPath(dataDir), `${JSON.stringify(journal, null, 2)}\n`)
}

export function removeJournal(dataDir: string) {
  rmSync(journalPath(dataDir), { force: true })
}
