/** Connects a Hermes profile to LeBot's memory: installs the provider plug-in into the profile,
 *  tells it where LeBot is, selects it, and switches Hermes' own two-file memory off so the bot
 *  has one memory. `removeMemory` undoes all of it. */
import { existsSync, readFileSync } from 'node:fs'
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { LegacyNotes, MemoryConnection } from '../bot-engine'

const PROVIDER = 'lebot-memory'
const PLUGIN_SOURCE = join(import.meta.dir, '..', '..', '..', 'engines', 'hermes', PROVIDER)
const HERMES_BIN = process.env.LEBOT_HERMES_BIN ?? 'hermes'
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** The version of the plug-in in this repo, read from its `plugin.yaml`. */
export const MEMORY_ADAPTER_VERSION = /^version:\s*(\S+)/m.exec(readFileSync(join(PLUGIN_SOURCE, 'plugin.yaml'), 'utf8'))?.[1] ?? 'unknown'

function profileHome(botId: string): string {
  if (!PROFILE_ID.test(botId)) throw new Error(`Not a profile id: ${botId}`)
  const hermesHome = process.env.HERMES_HOME ?? join(homedir(), '.hermes')
  return botId === 'default' ? hermesHome : join(hermesHome, 'profiles', botId)
}

async function configSet(botId: string, key: string, value: string) {
  const args = [...(botId === 'default' ? [] : ['-p', botId]), 'config', 'set', key, value]
  const child = Bun.spawn([HERMES_BIN, ...args], { stdout: 'ignore', stderr: 'pipe' })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`hermes config set ${key} exited ${code}: ${stderr.trim().slice(0, 200)}`)
}

/** Hermes separates the entries of its two memory files with a line holding only this sign. */
const ENTRY_SEPARATOR = /\n§\n/

async function entries(path: string): Promise<string[]> {
  const text = await readFile(path, 'utf8').catch(() => '')
  return text
    .split(ENTRY_SEPARATOR)
    .map(entry => entry.trim())
    .filter(Boolean)
}

export const memoryInstalled = (botId: string) => existsSync(join(profileHome(botId), `${PROVIDER}.json`))

/** What Hermes' own memory holds for this profile: USER.md is about the user, MEMORY.md is the bot's notes. */
export async function legacyNotes(botId: string): Promise<LegacyNotes> {
  const memories = join(profileHome(botId), 'memories')
  return { aboutUser: await entries(join(memories, 'USER.md')), ownNotes: await entries(join(memories, 'MEMORY.md')) }
}

export async function installMemory(botId: string, connection: MemoryConnection) {
  const home = profileHome(botId)
  await cp(PLUGIN_SOURCE, join(home, 'plugins', PROVIDER), { recursive: true, force: true, filter: source => !source.includes('__pycache__') })
  await writeFile(join(home, `${PROVIDER}.json`), `${JSON.stringify({ url: connection.url, token_file: connection.tokenFile }, null, 2)}\n`, { mode: 0o600 })
  await configSet(botId, 'memory.provider', PROVIDER)
  await configSet(botId, 'memory.memory_enabled', 'false')
  await configSet(botId, 'memory.user_profile_enabled', 'false')
}

export async function removeMemory(botId: string) {
  const home = profileHome(botId)
  await configSet(botId, 'memory.provider', '')
  await configSet(botId, 'memory.memory_enabled', 'true')
  await configSet(botId, 'memory.user_profile_enabled', 'true')
  await rm(join(home, 'plugins', PROVIDER), { recursive: true, force: true })
  await rm(join(home, `${PROVIDER}.json`), { force: true })
}
