/** Configures the dumb pass-through `lilbot-prompt-v1` middleware plug-in on a Hermes profile.
 *  All prompt assembly stays in LilBot (`server/prompts/`); the profile stores only a private
 *  pointer (`lilbot-prompt.json`) to LilBot's `<dataDir>/prompts/<botId>.txt` file. */
import { existsSync } from 'node:fs'
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PromptApplyResult, PromptSettings } from '../bot-engine'
import { adapterHash, applied, hashOf } from './hermes-applied'
import { requireProfileEnvironment } from './hermes-environment'
import { configurePlugin, removePlugin } from './hermes-plugins'
import { skillHome } from './hermes-skills'

const PROMPT_PLUGIN = 'lilbot-prompt-v1'
const SETTINGS_FILE = 'lilbot-prompt.json'
const PLUGIN_SOURCE = join(import.meta.dir, 'prompt-adapter')
const HERMES_IDENTITY_RE = /\bhermes\s+agent\b|\bnous\s+research\b/i

/** True when a bot's own saved instructions still carry Hermes's default identity wording. */
export const hasHermesIdentityText = (instructions: string): boolean => HERMES_IDENTITY_RE.test(instructions)

async function configurePrompt(id: string, settings: PromptSettings, activate = true): Promise<PromptApplyResult> {
  requireProfileEnvironment(id)
  const home = skillHome(id)
  const pluginDir = join(home, 'plugins', PROMPT_PLUGIN)
  const settingsPath = join(home, SETTINGS_FILE)
  if (!settings.enabled) {
    if (existsSync(pluginDir)) await removePlugin(id, PROMPT_PLUGIN)
    await rm(settingsPath, { force: true })
    return { active: false }
  }
  await mkdir(join(home, 'plugins'), { recursive: true })
  await cp(PLUGIN_SOURCE, pluginDir, { recursive: true, force: true, filter: src => !src.includes('__pycache__') })
  const tmp = `${settingsPath}.tmp`
  await writeFile(tmp, `${JSON.stringify({ botId: settings.botId, promptFile: settings.promptFile }, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, settingsPath)
  await configurePlugin(id, PROMPT_PLUGIN, { [`plugins.entries.${PROMPT_PLUGIN}.enabled`]: 'true' }, activate)
  return { active: true }
}

/** Deduplicated per-profile prompt plug-in applicator used by `HermesEngine`. */
export function promptApplicator() {
  const seen = new Map<string, string>()
  return async (id: string, settings: PromptSettings): Promise<PromptApplyResult> => {
    const key = JSON.stringify(settings)
    if (seen.get(id) === key) return { active: settings.enabled }
    const activate = settings.enabled && !seen.has(id)
    const stepKey = hashOf('prompt-v1', settings.enabled ? adapterHash('prompt-adapter') : 'off', settings)
    const result = await applied(id, 'prompt', stepKey, () => configurePrompt(id, settings, activate))
    seen.set(id, key)
    return { active: settings.enabled, ...(!settings.enabled && result ? {} : {}) }
  }
}
