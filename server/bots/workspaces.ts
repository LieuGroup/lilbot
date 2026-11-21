/** Each bot has its own folder on the shared computer: its workspace. Chats work there. */
import { lstat, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { LilBotError } from '../../shared/lilbot-error'

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

export class Workspaces {
  constructor(private root: string) {}

  /** The folder for a bot. The id becomes a folder name, so anything but a plain id is refused. */
  pathFor(botId: string): string {
    if (!SAFE_ID.test(botId)) throw new LilBotError('bot_not_found', 'That bot does not exist.')
    return join(this.root, botId)
  }

  /** Rename the entry itself, never follow workspace or archive symlinks. Stable target makes retries safe. */
  async remove(botId: string, choice: 'archive' | 'delete') {
    const source = this.pathFor(botId)
    if (choice === 'delete') return rm(source, { recursive: true, force: true })
    const archive = join(this.root, '.archive')
    await mkdir(archive, { recursive: true, mode: 0o700 })
    if (!(await lstat(archive)).isDirectory()) throw new Error('The workspace archive must be a directory.')
    try {
      await rename(source, join(archive, botId))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  /** Makes sure the folder exists (private to the user) and returns its path. */
  async ensure(botId: string): Promise<string> {
    const path = this.pathFor(botId)
    await mkdir(path, { recursive: true, mode: 0o700 })
    return path
  }
}
