/** Configures the dumb pass-through `lilbot-prompt-v1` middleware plug-in on a Hermes profile.
 *  All prompt assembly stays in LilBot (`server/prompts/`); the profile stores only a private
 *  pointer (`lilbot-prompt.json`) to LilBot's `<dataDir>/prompts/<botId>.txt` file, and the plug-in
 *  records what it last did in `lilbot-prompt-status.json` (a fixed label, never a path or prompt text).
 *  Hermes loads a plug-in only from its `plugins.enabled` list (`gate_manifest`), so on and off both go
 *  through Hermes' own enable and disable, and LilBot reads that list to know whether the plug-in loads. */
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PromptApplyResult, PromptSettings } from '../bot-engine'
import { adapterHash, applied, hashOf } from './hermes-applied'
import { requireProfileEnvironment } from './hermes-environment'
import { configurePlugin, removePlugin } from './hermes-plugins'
import { skillHome } from './hermes-skills'

const PROMPT_PLUGIN = 'lilbot-prompt-v1'
const SETTINGS_FILE = 'lilbot-prompt.json'
const STATUS_FILE = 'lilbot-prompt-status.json'
const PLUGIN_SOURCE = join(import.meta.dir, 'prompt-adapter')
const HERMES_IDENTITY_RE = /\bhermes\s+agent\b|\bnous\s+research\b/i

/** True when a bot's own saved instructions still carry Hermes's default identity wording. */
export const hasHermesIdentityText = (instructions: string): boolean => HERMES_IDENTITY_RE.test(instructions)

/** Whether Hermes loads the prompt plug-in for this profile home: listed in `plugins.enabled` and not in `plugins.disabled`. */
export function promptPluginEnabled(home: string): boolean {
  try {
    const plugins = (Bun.YAML.parse(readFileSync(join(home, 'config.yaml'), 'utf8')) as { plugins?: Record<string, unknown> } | null)?.plugins
    const list = (key: string) => (Array.isArray(plugins?.[key]) ? (plugins[key] as unknown[]) : [])
    return list('enabled').includes(PROMPT_PLUGIN) && !list('disabled').includes(PROMPT_PLUGIN)
  } catch {
    return false
  }
}

const readJson = (path: string): any => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** Whether the profile sends LilBot's prompt, from Hermes' plug-in list and what the plug-in last recorded. */
function promptStatus(id: string): PromptApplyResult {
  const home = skillHome(id)
  if (!promptPluginEnabled(home)) return { active: false, reason: 'prompt plug-in not enabled' }
  const status = readJson(join(home, STATUS_FILE))
  // No record yet: Hermes lists the plug-in, and it writes one the moment it loads or a request finds a problem.
  if (status?.state !== 'fallback') return { active: true }
  // The last request fell back; the plug-in records `active` again as soon as one gets LilBot's prompt.
  return { active: false, reason: typeof status.reason === 'string' && status.reason ? status.reason.slice(0, 80) : 'prompt plug-in fell back' }
}

export interface PromptPluginOps {
  enable(id: string): Promise<void>
  disable(id: string): Promise<void>
}

const hermesOps: PromptPluginOps = {
  enable: id => configurePlugin(id, PROMPT_PLUGIN, {}, true),
  disable: id => removePlugin(id, PROMPT_PLUGIN)
}

async function switchOn(id: string, settings: PromptSettings, ops: PromptPluginOps) {
  const home = skillHome(id)
  const settingsPath = join(home, SETTINGS_FILE)
  await mkdir(join(home, 'plugins'), { recursive: true })
  await cp(PLUGIN_SOURCE, join(home, 'plugins', PROMPT_PLUGIN), { recursive: true, force: true, filter: src => !src.includes('__pycache__') })
  const tmp = `${settingsPath}.tmp`
  await writeFile(tmp, `${JSON.stringify({ botId: settings.botId, promptFile: settings.promptFile }, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, settingsPath)
  await rm(join(home, STATUS_FILE), { force: true })
  await ops.enable(id)
}

/** Off writes nothing to a profile that never had the plug-in; otherwise Hermes disables and removes it. */
async function switchOff(id: string, ops: PromptPluginOps) {
  const home = skillHome(id)
  const pluginDir = join(home, 'plugins', PROMPT_PLUGIN)
  const files = [SETTINGS_FILE, STATUS_FILE].map(name => join(home, name))
  if (!existsSync(pluginDir) && !files.some(existsSync) && !promptPluginEnabled(home)) return
  // Recording `off` makes a later switch back on apply again even with unchanged settings.
  await applied(
    id,
    null,
    '',
    async () => {
      if (existsSync(pluginDir)) await ops.disable(id)
      for (const file of files) await rm(file, { force: true })
    },
    { prompt: 'off' }
  )
}

/** Deduplicated per-profile prompt plug-in applicator used by `HermesEngine`. */
export function promptApplicator(ops: PromptPluginOps = hermesOps) {
  const seen = new Map<string, string>()
  return async (id: string, settings: PromptSettings): Promise<PromptApplyResult> => {
    requireProfileEnvironment(id)
    const key = JSON.stringify(settings)
    if (seen.get(id) !== key) {
      const step = hashOf('prompt-v2', adapterHash('prompt-adapter'), settings)
      const run = () => switchOn(id, settings, ops)
      // A profile whose settings file or `plugins.enabled` entry went missing is set up again even if nothing else changed.
      const intact = existsSync(join(skillHome(id), SETTINGS_FILE)) && promptPluginEnabled(skillHome(id))
      if (!settings.enabled) await switchOff(id, ops)
      else if (intact) await applied(id, 'prompt', step, run)
      else await applied(id, null, '', run, { prompt: step })
      seen.set(id, key)
    }
    return settings.enabled ? promptStatus(id) : { active: false }
  }
}
