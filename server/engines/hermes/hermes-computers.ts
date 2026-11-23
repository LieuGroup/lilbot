/** Retires the legacy Hermes computers plug-in (`lilbot-computers-v1`) and its settings file during normal start-up.
 *  Computer tools now live on LilBot's own System MCP server (`server/system/tool-computers.ts`). */
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { removePlugin } from './hermes-plugins'
import { skillHome } from './hermes-skills'

export const COMPUTERS_PLUGIN = 'lilbot-computers-v1'
export const COMPUTERS_RETIRED_KEY = 'retired-v1'

export async function retireComputersPlugin(id: string, uninstall = removePlugin): Promise<void> {
  const home = skillHome(id)
  if (existsSync(join(home, 'plugins', COMPUTERS_PLUGIN))) {
    await uninstall(id, COMPUTERS_PLUGIN)
  }
  await rm(join(home, 'lilbot-computers.json'), { force: true })
}
