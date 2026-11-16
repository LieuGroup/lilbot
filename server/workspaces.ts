/** Each bot has its own folder on the shared computer: its workspace. Chats work there. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { LeBotError } from '../shared/protocol'

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

export class Workspaces {
  constructor(private root: string) {}

  /** The folder for a bot. The id becomes a folder name, so anything but a plain id is refused. */
  pathFor(botId: string): string {
    if (!SAFE_ID.test(botId)) throw new LeBotError('bot_not_found', 'That bot does not exist.')
    return join(this.root, botId)
  }

  /** Makes sure the folder exists (private to the user) and returns its path. */
  async ensure(botId: string): Promise<string> {
    const path = this.pathFor(botId)
    await mkdir(path, { recursive: true, mode: 0o700 })
    return path
  }
}
