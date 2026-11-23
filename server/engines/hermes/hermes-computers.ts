/** Retires the legacy Hermes computers plug-in (`lilbot-computers-v1`) and its settings file during normal start-up.
 *  Computer tools now live on LilBot's own System MCP server (`server/system/tool-computers.ts`). */
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { hermesCli, removePlugin } from './hermes-plugins'
import { skillHome } from './hermes-skills'

export const COMPUTERS_PLUGIN = 'lilbot-computers-v1'
export const COMPUTERS_RETIRED_KEY = 'retired-v1'

interface StalePluginConfig {
  enabled?: string[]
  disabled?: string[]
  hasEntry: boolean
}

function stalePluginConfig(yaml: string): StalePluginConfig | null {
  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(yaml)
  } catch {
    return null
  }
  const plugins = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).plugins : undefined
  if (!plugins || typeof plugins !== 'object') return null
  const cfg = plugins as Record<string, unknown>
  const withoutPlugin = (raw: unknown) => (Array.isArray(raw) && raw.includes(COMPUTERS_PLUGIN) ? raw.filter(name => name !== COMPUTERS_PLUGIN).map(String) : undefined)
  const enabled = withoutPlugin(cfg.enabled)
  const disabled = withoutPlugin(cfg.disabled)
  const hasEntry = Boolean(cfg.entries && typeof cfg.entries === 'object' && Object.hasOwn(cfg.entries, COMPUTERS_PLUGIN))
  return enabled || disabled || hasEntry ? { enabled, disabled, hasEntry } : null
}

async function clearStaleConfigEntries(id: string, home: string, runCli: typeof hermesCli): Promise<void> {
  const configPath = join(home, 'config.yaml')
  if (!existsSync(configPath)) return
  const stale = stalePluginConfig(await readFile(configPath, 'utf8'))
  if (!stale) return
  if (stale.enabled) await runCli(id, ['config', 'set', 'plugins.enabled', JSON.stringify(stale.enabled)])
  if (stale.disabled) await runCli(id, ['config', 'set', 'plugins.disabled', JSON.stringify(stale.disabled)])
  if (stale.hasEntry) await runCli(id, ['config', 'unset', `plugins.entries.${COMPUTERS_PLUGIN}`])
}

export async function retireComputersPlugin(id: string, uninstall = removePlugin, runCli = hermesCli): Promise<void> {
  const home = skillHome(id)
  if (existsSync(join(home, 'plugins', COMPUTERS_PLUGIN))) {
    await uninstall(id, COMPUTERS_PLUGIN)
  }
  await clearStaleConfigEntries(id, home, runCli)
  await rm(join(home, 'lilbot-computers.json'), { force: true })
}
