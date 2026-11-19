/** Independent tool plugin. Does not change the memory adapter or its settings. */
import { cp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { skillHome } from './hermes-skills'
import { HermesSocket } from './hermes-socket'

export async function configureComputers(id: string, settings: { url: string; tokenFile: string; botId: string }) {
  const home = skillHome(id)
  const plugin = 'lilbot-computers-v1'
  await cp(join(import.meta.dir, 'computers-adapter'), join(home, 'plugins', plugin), { recursive: true, filter: source => !source.includes('__pycache__') })
  await writeFile(join(home, 'lilbot-computers.json'), JSON.stringify(settings), { mode: 0o600 })
  for (const args of [
    ['config', 'set', `plugins.entries.${plugin}.enabled`, 'true'],
    ['plugins', 'enable', plugin]
  ]) {
    const child = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', ...(id === 'default' ? [] : ['-p', id]), ...args], { env: process.env, stdout: 'ignore', stderr: 'ignore' })
    if ((await child.exited) !== 0) throw new Error('Could not configure computer tools.')
  }
  const socket = await HermesSocket.connect(id === 'default' ? '' : id)
  try {
    await socket.request('plugins.manage', { action: 'toggle', name: plugin, enable: false })
    const result = await socket.request('plugins.manage', { action: 'toggle', name: plugin, enable: true })
    if (!result.ok) throw new Error('Computer plugin activation failed.')
  } finally {
    socket.close()
  }
}
