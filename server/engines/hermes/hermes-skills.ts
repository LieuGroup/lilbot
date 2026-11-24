import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SkillSettings } from '../bot-engine'
import { requireProfileEnvironment } from './hermes-environment'
import { configurePlugin, hermesCli } from './hermes-plugins'

export function skillHome(id: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new Error('Invalid profile id')
  const root = process.env.HERMES_HOME ?? join(homedir(), '.hermes')
  return id === 'default' ? root : join(root, 'profiles', id)
}
/** Hermes refuses to disable these (`ESSENTIAL_SKILLS` in agent/skill_utils.py); `check:skills` confirms they stay offered. */
export const ALWAYS_ON_SKILLS = [{ name: 'hermes-agent', reason: 'Part of the engine, cannot be switched off.' }] as const

/** The installed manifest records the skills Hermes ships, by name:hash. */
function shippedSkills(id: string) {
  const manifest = join(skillHome(id), 'skills', '.bundled_manifest')
  return new Set(
    existsSync(manifest)
      ? readFileSync(manifest, 'utf8')
          .split('\n')
          .map(line => line.split(':')[0])
      : []
  )
}
/** The skills Hermes offers by itself that its `skills.disabled` list can hide. */
export function bundledSkillNames(id: string) {
  requireProfileEnvironment(id)
  return [...shippedSkills(id)].filter(name => name && !ALWAYS_ON_SKILLS.some(skill => skill.name === name))
}
/** What decides whether the profile's skill configuration is applied again. With the engine's skills included it is what it was
 *  before the switch existed, so a release that adds the switch leaves every profile alone. */
export function skillsFingerprint(id: string, { includeEngineSkills, ...settings }: SkillSettings) {
  return includeEngineSkills ? [settings, userSkillPaths(id)] : [settings, userSkillPaths(id), bundledSkillNames(id)]
}
/** Never copy the skills Hermes ships. */
export function userSkillPaths(id: string) {
  requireProfileEnvironment(id)
  const root = join(skillHome(id), 'skills')
  const shipped = shippedSkills(id)
  const result: string[] = []
  function walk(path: string) {
    if (!existsSync(path)) return
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = join(path, entry.name)
      if (existsSync(join(dir, 'SKILL.md'))) {
        const text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
        const name = /^name:\s*["']?([^\r\n"']+)/m.exec(text)?.[1]?.trim() ?? entry.name
        if (!shipped.has(name) && !shipped.has(entry.name)) result.push(dir)
      } else walk(dir)
    }
  }
  walk(root)
  return result
}
/** Reads any existing `known_plugin_toolsets.acp` entries and includes `'skills'` so ACP sessions that omit
 *  `'skills'` (such as memory reviews) are not auto-enrolled in `lilbot-skills-v1` as an unknown plugin toolset. */
export function knownAcpPluginToolsets(home: string): string[] {
  const configPath = join(home, 'config.yaml')
  let existing: string[] = []
  if (existsSync(configPath)) {
    try {
      const parsed = Bun.YAML.parse(readFileSync(configPath, 'utf8'))
      const acp = (parsed as { known_plugin_toolsets?: { acp?: unknown } } | null)?.known_plugin_toolsets?.acp
      if (Array.isArray(acp)) existing = acp.filter((name): name is string => typeof name === 'string' && name.length > 0)
    } catch {}
  }
  return [...new Set([...existing, 'skills'])]
}

export async function configureSkills(id: string, settings: SkillSettings, activate = true) {
  const home = skillHome(id)
  const plugin = 'lilbot-skills-v1'
  await mkdir(join(home, 'plugins'), { recursive: true })
  await cp(join(import.meta.dir, 'skills-adapter'), join(home, 'plugins', plugin), { recursive: true })
  await writeFile(join(home, 'lilbot-skills.json'), JSON.stringify(settings), { mode: 0o600 })
  // Preserve profile files but suppress their stale user-skill manifest entries. The plugin supplies
  // the authoritative catalog and tools; shipped engine skills still use Hermes' own implementation.
  const values: Record<string, unknown> = {
    'known_plugin_toolsets.acp': knownAcpPluginToolsets(home),
    'skills.create_dir': settings.root,
    'skills.external_dirs': [settings.root],
    'skills.disabled': [
      ...new Set([
        ...settings.names,
        ...userSkillPaths(id)
          .map(path => /^name:\s*["']?([^\r\n"']+)/m.exec(readFileSync(join(path, 'SKILL.md'), 'utf8'))?.[1]?.trim())
          .filter(Boolean),
        ...(settings.includeEngineSkills ? [] : bundledSkillNames(id))
      ])
    ]
  }
  for (const [key, value] of Object.entries(values)) await hermesCli(id, ['config', 'set', key, typeof value === 'string' ? value : JSON.stringify(value)])
  // Live handlers read the settings file for each request; catalogue changes need no plugin reload.
  const entry = `plugins.entries.${plugin}`
  await configurePlugin(id, plugin, { [`${entry}.enabled`]: 'true', [`${entry}.allow_tool_override`]: 'true' }, activate)
}
