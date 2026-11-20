import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { configurePlugin, hermesCli } from './hermes-plugins'

export function skillHome(id: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new Error('Invalid profile id')
  const root = process.env.HERMES_HOME ?? join(homedir(), '.hermes')
  return id === 'default' ? root : join(root, 'profiles', id)
}
/** The installed manifest records shipped skills by name:hash. Never copy those. */
export function userSkillPaths(id: string) {
  const root = join(skillHome(id), 'skills')
  const manifest = join(root, '.bundled_manifest')
  const shipped = new Set(
    existsSync(manifest)
      ? readFileSync(manifest, 'utf8')
          .split('\n')
          .map(line => line.split(':')[0])
      : []
  )
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
export async function configureSkills(id: string, settings: { root: string; url: string; tokenFile: string; botId: string; disabled: string[]; names: string[] }, activate = true) {
  const home = skillHome(id)
  const plugin = 'lilbot-skills-v1'
  await mkdir(join(home, 'plugins'), { recursive: true })
  await cp(join(import.meta.dir, 'skills-adapter'), join(home, 'plugins', plugin), { recursive: true })
  await writeFile(join(home, 'lilbot-skills.json'), JSON.stringify(settings), { mode: 0o600 })
  // Preserve profile files but suppress their stale user-skill manifest entries. The plugin supplies
  // the authoritative catalog and tools; shipped engine skills still use Hermes' own implementation.
  const values: Record<string, unknown> = {
    'skills.create_dir': settings.root,
    'skills.external_dirs': [settings.root],
    'skills.disabled': [
      ...new Set([
        ...settings.names,
        ...userSkillPaths(id)
          .map(path => /^name:\s*["']?([^\r\n"']+)/m.exec(readFileSync(join(path, 'SKILL.md'), 'utf8'))?.[1]?.trim())
          .filter(Boolean)
      ])
    ]
  }
  for (const [key, value] of Object.entries(values)) await hermesCli(id, ['config', 'set', key, typeof value === 'string' ? value : JSON.stringify(value)])
  // Live handlers read the settings file for each request; catalogue changes need no plugin reload.
  const entry = `plugins.entries.${plugin}`
  await configurePlugin(id, plugin, { [`${entry}.enabled`]: 'true', [`${entry}.allow_tool_override`]: 'true' }, activate)
}
