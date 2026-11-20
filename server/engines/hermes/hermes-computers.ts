/** Independent tool plugin. Does not change the memory adapter or its settings. */
import { cp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configurePlugin } from './hermes-plugins'
import { skillHome } from './hermes-skills'

export async function configureComputers(id: string, settings: { url: string; tokenFile: string; botId: string }) {
  const home = skillHome(id)
  const plugin = 'lilbot-computers-v1'
  await cp(join(import.meta.dir, 'computers-adapter'), join(home, 'plugins', plugin), { recursive: true, filter: source => !source.includes('__pycache__') })
  await writeFile(join(home, 'lilbot-computers.json'), JSON.stringify(settings), { mode: 0o600 })
  await configurePlugin(id, plugin, { [`plugins.entries.${plugin}.enabled`]: 'true' }, true)
}
