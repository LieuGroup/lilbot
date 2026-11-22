/** Durable journal for bot re-keying and undo: pins target id, backup dir, mode, and completed steps for crash recovery. */
import { chmodSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const JOURNAL_FILE = 'rekey-journal.json'

interface RekeyJournalSteps {
  backup: boolean
  db: boolean
  workspace: boolean
  archive: boolean
  hermes: boolean
}

export interface RekeyJournal {
  version: 1
  mode: 'rekey' | 'undo'
  from: string
  to: string
  engineBotId: string
  backupDir: string
  dataDir: string
  workspacesDir: string | null
  hermesHome: string | null
  clearMainChat: boolean
  steps: RekeyJournalSteps
}

export function writeAtomicPrivate(path: string, content: string) {
  const tmp = `${path}.rekey-tmp-${process.pid}`
  writeFileSync(tmp, content, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}

export const journalPath = (dataDir: string) => join(dataDir, JOURNAL_FILE)

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isNullableString = (v: unknown): v is string | null => v === null || isNonEmptyString(v)

function isValidSteps(v: unknown): v is RekeyJournalSteps {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const s = v as Record<string, unknown>
  return typeof s.backup === 'boolean' && typeof s.db === 'boolean' && typeof s.workspace === 'boolean' && typeof s.archive === 'boolean' && typeof s.hermes === 'boolean'
}

/** Reads and strictly validates `<data>/rekey-journal.json`. Never throws raw SyntaxError or TypeError. */
export function readJournal(dataDir: string): RekeyJournal | null {
  const path = journalPath(dataDir)
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`Unable to inspect rekey journal at ${path}; fix permissions or inspect before continuing.`)
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing to read non-regular rekey journal at ${path}; inspect before continuing.`)

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`Corrupt rekey journal at ${path}; inspect it or restore from backup with --undo <backupDir> before continuing.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Corrupt rekey journal at ${path}; inspect it or restore from backup with --undo <backupDir> before continuing.`)
  }
  const j = parsed as Record<string, unknown>
  const mode = j.mode === undefined ? 'rekey' : j.mode
  const valid =
    j.version === 1 &&
    (mode === 'rekey' || mode === 'undo') &&
    isNonEmptyString(j.from) &&
    isNonEmptyString(j.to) &&
    isNonEmptyString(j.engineBotId) &&
    isNonEmptyString(j.backupDir) &&
    isNonEmptyString(j.dataDir) &&
    isNullableString(j.workspacesDir) &&
    isNullableString(j.hermesHome) &&
    typeof j.clearMainChat === 'boolean' &&
    isValidSteps(j.steps)
  if (!valid) {
    throw new Error(`Corrupt rekey journal at ${path}; inspect it or restore from backup with --undo <backupDir> before continuing.`)
  }
  return { ...(j as unknown as RekeyJournal), mode }
}

export function writeJournal(dataDir: string, journal: RekeyJournal) {
  writeAtomicPrivate(journalPath(dataDir), `${JSON.stringify(journal, null, 2)}\n`)
}

export function removeJournal(dataDir: string) {
  rmSync(journalPath(dataDir), { force: true })
}

/** Refuses forward re-key if an undo is in progress, target differs, or disk scope was narrowed/changed on resume. */
export function assertJournalMatchesRekey(journal: RekeyJournal, options: { from: string; to?: string; workspacesDir: string | null; hermesHome: string | null }) {
  if (journal.mode === 'undo') {
    throw new Error(`Unfinished undo in progress for "${journal.to}" -> "${journal.from}"; finish with --undo ${journal.backupDir} --yes first.`)
  }
  if (journal.from !== options.from) {
    throw new Error(`Unfinished rekey journal found for "${journal.from}" -> "${journal.to}"; resume or --undo ${journal.backupDir} first.`)
  }
  if (options.to !== undefined && options.to !== journal.to) {
    throw new Error(`Unfinished rekey journal pins target id "${journal.to}" (got --to "${options.to}").`)
  }
  if (journal.workspacesDir !== null && (options.workspacesDir === null || resolve(options.workspacesDir) !== resolve(journal.workspacesDir))) {
    throw new Error(
      `Unfinished rekey journal requires --workspaces-dir ${journal.workspacesDir} (cannot resume with --skip-workspaces or a different path); resume with matching flags or run --undo ${journal.backupDir} --yes.`
    )
  }
  if (journal.hermesHome !== null && (options.hermesHome === null || resolve(options.hermesHome) !== resolve(journal.hermesHome))) {
    throw new Error(
      `Unfinished rekey journal requires --hermes-home ${journal.hermesHome} (cannot resume with --skip-hermes or a different path); resume with matching flags or run --undo ${journal.backupDir} --yes.`
    )
  }
}
