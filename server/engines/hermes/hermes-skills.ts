import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HermesSocket } from './hermes-socket'

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
    ],
    [`plugins.entries.${plugin}.enabled`]: true,
    [`plugins.entries.${plugin}.allow_tool_override`]: true
  }
  for (const [key, value] of Object.entries(values)) {
    const child = Bun.spawn(
      [process.env.LILBOT_HERMES_BIN ?? 'hermes', ...(id === 'default' ? [] : ['-p', id]), 'config', 'set', key, typeof value === 'string' ? value : JSON.stringify(value)],
      {
        env: process.env,
        stdout: 'ignore',
        stderr: 'pipe'
      }
    )
    const error = await new Response(child.stderr).text()
    if ((await child.exited) !== 0) throw new Error(`Could not configure ${key}: ${error.slice(0, 200)}`)
  }
  // Live handlers read this file for each request; catalogue changes need no plugin reload.
  if (!activate) return
  const enable = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', ...(id === 'default' ? [] : ['-p', id]), 'plugins', 'enable', plugin, '--allow-tool-override'], {
    env: process.env,
    stdout: 'ignore',
    stderr: 'pipe'
  })
  const enableError = await new Response(enable.stderr).text()
  if ((await enable.exited) !== 0) throw new Error(`Could not enable skills: ${enableError.slice(0, 200)}`)
  const socket = await HermesSocket.connect(id === 'default' ? '' : id)
  try {
    await socket.request('plugins.manage', { action: 'toggle', name: plugin, enable: false })
    const result = await socket.request('plugins.manage', { action: 'toggle', name: plugin, enable: true })
    if (!result.ok) throw new Error('Skills plugin activation failed')
  } finally {
    socket.close()
  }
}
