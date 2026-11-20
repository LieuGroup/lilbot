/** What LilBot last applied to a Hermes profile, kept in the profile's own folder so a deleted or
 *  re-created profile starts clean. A start-up step is skipped only when its inputs are unchanged and
 *  the profile's `config.yaml` is byte-for-byte what it was when the last LilBot change to it finished,
 *  so an outside edit applies everything again. The file holds hashes only, never credentials. */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { skillHome } from './hermes-skills'

const FILE = 'lilbot-applied.json'
type Applied = { config: string; steps: Record<string, string> }

export const hashOf = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)

/** One change to a profile at a time: steps share the profile's config file and this record. */
const queues = new Map<string, Promise<unknown>>()

async function configHash(home: string) {
  return createHash('sha256')
    .update(await readFile(join(home, 'config.yaml')).catch(() => ''))
    .digest('hex')
}

async function load(home: string): Promise<Applied | null> {
  try {
    const record = JSON.parse(await readFile(join(home, FILE), 'utf8'))
    return typeof record?.config === 'string' && record.steps && typeof record.steps === 'object' ? record : null
  } catch {
    return null
  }
}

/** Runs `run` unless `step` was already applied with `key` and the profile is untouched since; then records it.
 *  Without a step it always runs and only keeps the record in step with a change LilBot made to the config
 *  (memory setup, identity). Returns whether it ran. */
export function applied(id: string, step: string | null, key: string, run: () => Promise<void>): Promise<boolean> {
  const home = skillHome(id)
  const turn = (queues.get(id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const before = await load(home)
      const intact = !!before && before.config === (await configHash(home))
      if (step && intact && before.steps[step] === key) return false
      await run()
      const config = await configHash(home)
      // A pass that changed nothing (identity is checked on every chat) writes nothing.
      if (!step && intact && before.config === config) return true
      const steps = { ...(intact ? before.steps : {}), ...(step ? { [step]: key } : {}) }
      const file = join(home, `${FILE}.tmp`)
      await writeFile(file, JSON.stringify({ config, steps }), { mode: 0o600 })
      await rename(file, join(home, FILE))
      return true
    })
  queues.set(id, turn)
  return turn
}

const codeHashes = new Map<string, string>()
/** Hash of an adapter folder shipped with LilBot (file names and contents), read once per process. */
export function adapterHash(folder: string): string {
  let hash = codeHashes.get(folder)
  if (!hash) {
    const root = join(import.meta.dir, folder)
    const digest = createHash('sha256')
    const found = readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && !entry.parentPath.includes('__pycache__'))
    for (const path of found.map(entry => join(entry.parentPath, entry.name)).sort()) digest.update(path.slice(root.length)).update(readFileSync(path))
    hash = digest.digest('hex').slice(0, 32)
    codeHashes.set(folder, hash)
  }
  return hash
}
