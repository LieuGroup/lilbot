import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The canonical LilBot memory rules embedded into review/checkpoint prompts (and kept in sync with the Hermes adapter). */
export const MEMORY_RULES = readFileSync(join(import.meta.dir, 'rules.md'), 'utf8').trimEnd()
