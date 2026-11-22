/** Connects a Hermes profile to LilBot's memory: installs the provider plug-in into the profile,
 *  tells it where LilBot is, selects it, and switches Hermes' own two-file memory off so the bot
 *  has one memory. Then Hermes may shorten the conversation only after the plug-in has saved it
 *  (`compression.checkpoint_required`, #148). `removeMemory` undoes all of it.
 *
 *  The Hermes gateway keeps a plug-in's code loaded per folder until it restarts. So each version
 *  of the plug-in is installed under its own folder name (`lilbot-memory-v0-3-0`): a new version is
 *  a new folder, which Hermes loads fresh on the bot's next session, with no gateway restart. */

import { createHmac } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LegacyNotes, MemoryConnection, RuntimeBinding } from '../bot-engine'
import { applied } from './hermes-applied'

/** The name Hermes knows the provider by (plus a version). The data is not here: it is LilBot's. */
const PLUGIN = 'lilbot-memory'
/** The adapter's source in this repo: the only memory code that is specific to Hermes. */
const PLUGIN_SOURCE = join(import.meta.dir, 'memory-adapter')
const SETTINGS_FILE = `${PLUGIN}.json`
const HERMES_BIN = process.env.LILBOT_HERMES_BIN ?? 'hermes'
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** The version of the plug-in in this repo, read from its `plugin.yaml`. */
export const MEMORY_ADAPTER_VERSION = /^version:\s*(\S+)/m.exec(readFileSync(join(PLUGIN_SOURCE, 'plugin.yaml'), 'utf8'))?.[1] ?? 'unknown'

/** The name Hermes knows this version of the provider by: also its folder name. */
const providerName = (version: string) => `${PLUGIN}-v${version.replaceAll('.', '-')}`

export function profileHome(botId: string): string {
  if (!PROFILE_ID.test(botId)) throw new Error(`Not a profile id: ${botId}`)
  const hermesHome = process.env.HERMES_HOME ?? join(homedir(), '.hermes')
  return botId === 'default' ? hermesHome : join(hermesHome, 'profiles', botId)
}

/** Folders of any version of the plug-in in a profile. */
function installedFolders(home: string): string[] {
  const plugins = join(home, 'plugins')
  return existsSync(plugins) ? readdirSync(plugins).filter(name => name === PLUGIN || name.startsWith(`${PLUGIN}-v`)) : []
}

async function configSet(botId: string, key: string, value: string) {
  const args = [...(botId === 'default' ? [] : ['-p', botId]), 'config', 'set', key, value]
  const child = Bun.spawn([HERMES_BIN, ...args], { env: process.env, stdout: 'ignore', stderr: 'pipe' })
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

/** Whether the profile's memory settings file is readable and bound to `expectedBotId` (defaults to the profile id). */
export function memoryInstalled(engineBotId: string, expectedBotId = engineBotId): boolean {
  try {
    const settings = JSON.parse(readFileSync(join(profileHome(engineBotId), SETTINGS_FILE), 'utf8'))
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
    if (typeof settings.bot_id === 'string') return settings.bot_id.length > 0 && settings.bot_id === expectedBotId
    return settings.bot_id === undefined && typeof settings.url === 'string' && typeof settings.token_file === 'string' && engineBotId === expectedBotId
  } catch {
    return false
  }
}

/** Whether a connected bot has this repo's version of the plug-in. */
const memoryCurrent = (botId: string) => installedFolders(profileHome(botId)).includes(providerName(MEMORY_ADAPTER_VERSION))

/** Where a connected bot was told LilBot is, so an upgrade keeps the same connection. */
async function memorySettings(botId: string): Promise<(MemoryConnection & { creationCapability?: string }) | null> {
  try {
    const settings = JSON.parse(await readFile(join(profileHome(botId), SETTINGS_FILE), 'utf8'))
    return typeof settings.url === 'string' && typeof settings.token_file === 'string'
      ? {
          url: settings.url,
          tokenFile: settings.token_file,
          botId: typeof settings.bot_id === 'string' ? settings.bot_id : undefined,
          creationCapability: typeof settings.creation_capability === 'string' ? settings.creation_capability : undefined
        }
      : null
  } catch {
    return null
  }
}

async function memoryCapability(tokenFile: string, botId: string): Promise<string> {
  return createHmac('sha256', (await readFile(tokenFile, 'utf8')).trim())
    .update(`create-bot:${botId}`)
    .digest('hex')
}

async function writeMemorySettings(home: string, connection: MemoryConnection, botId: string) {
  const file = join(home, `${SETTINGS_FILE}.tmp`)
  const payload = {
    url: connection.url,
    token_file: connection.tokenFile,
    bot_id: botId,
    creation_capability: await memoryCapability(connection.tokenFile, botId)
  }
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  await rename(file, join(home, SETTINGS_FILE))
}

/** What Hermes' own memory holds for this profile: USER.md is about the user, MEMORY.md is the bot's notes. */
export async function legacyNotes(botId: string): Promise<LegacyNotes> {
  const memories = join(profileHome(botId), 'memories')
  return { aboutUser: await entries(join(memories, 'USER.md')), ownNotes: await entries(join(memories, 'MEMORY.md')) }
}

/** Installs this repo's version of the plug-in, replacing any other version. Safe to repeat. */
export async function installMemory(botId: string, connection: MemoryConnection) {
  const home = profileHome(botId)
  const name = providerName(MEMORY_ADAPTER_VERSION)
  const target = join(home, 'plugins', name)
  for (const folder of installedFolders(home)) if (folder !== name) await rm(join(home, 'plugins', folder), { recursive: true, force: true })
  await cp(PLUGIN_SOURCE, target, { recursive: true, force: true, filter: source => !source.includes('__pycache__') })
  // Hermes selects a provider by name; the installed copy carries its versioned one.
  const manifest = await readFile(join(PLUGIN_SOURCE, 'plugin.yaml'), 'utf8')
  await writeFile(join(target, 'plugin.yaml'), manifest.replace(/^name:.*$/m, `name: ${name}`))
  await writeMemorySettings(home, connection, connection.botId ?? botId)
  await configSet(botId, 'memory.provider', name)
  await configSet(botId, 'memory.memory_enabled', 'false')
  await configSet(botId, 'memory.user_profile_enabled', 'false')
  await configSet(botId, 'compression.checkpoint_required', 'true')
}

export async function removeMemory(botId: string) {
  const home = profileHome(botId)
  await configSet(botId, 'compression.checkpoint_required', 'false')
  await configSet(botId, 'memory.provider', '')
  await configSet(botId, 'memory.memory_enabled', 'true')
  await configSet(botId, 'memory.user_profile_enabled', 'true')
  for (const folder of installedFolders(home)) await rm(join(home, 'plugins', folder), { recursive: true, force: true })
  await rm(join(home, SETTINGS_FILE), { force: true })
}

/** Upgrades connected adapters and repairs drifted connection settings or capabilities. Profiles whose settings are
 *  missing or bound to a different bot id are skipped here so `connectAllMemory` connects them cleanly once. */
export async function refreshMemoryAdapters(bots: RuntimeBinding[], current?: MemoryConnection): Promise<string[]> {
  const updated: string[] = []
  for (const { id: botId, engineBotId } of bots) {
    if (!memoryInstalled(engineBotId, botId)) continue
    try {
      const saved = await memorySettings(engineBotId)
      if (!saved && !current) continue
      const url = current?.url ?? saved!.url
      const tokenFile = current?.tokenFile ?? saved!.tokenFile
      const connection: MemoryConnection = { url, tokenFile, botId }
      // Fail-closed again after the deploy watchdog cleared it for a rollback (`server/deploy/rollback-profiles.ts`);
      // once, not on every start: a changed `checkpoint_required` rebuilds every cached Hermes agent of the bot.
      if (memoryCurrent(engineBotId)) {
        const expectedCapability = await memoryCapability(tokenFile, botId)
        if (!saved || saved.url !== url || saved.tokenFile !== tokenFile || saved.botId !== botId || saved.creationCapability !== expectedCapability) {
          await writeMemorySettings(profileHome(engineBotId), connection, botId)
          updated.push(engineBotId)
        }
        await applied(engineBotId, 'checkpoint', '1', () => configSet(engineBotId, 'compression.checkpoint_required', 'true'))
        continue
      }
      await applied(engineBotId, null, '', () => installMemory(engineBotId, connection))
      updated.push(engineBotId)
    } catch {
      console.error('[memory] could not update the memory adapter for a bot')
    }
  }
  return updated
}
