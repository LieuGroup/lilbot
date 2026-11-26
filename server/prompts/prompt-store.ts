/** Private per-bot prompt file store under `<dataDir>/prompts/<botId>.txt`.
 *  Keyed strictly by LilBot's bot id (never bot name or engine profile id), created with private
 *  modes (`0o700` directory, `0o600` files), written atomically, removed on bot deletion, and
 *  never logged because prompt files hold the bot's instructions. */
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BOT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

/** Off by default so turning on engine-level prompt ownership for existing production bots is an
 *  explicit reversible switch (`LILBOT_PROMPT_OWNERSHIP=1`). */
export const isPromptOwnershipEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.LILBOT_PROMPT_OWNERSHIP === '1'

export class PromptStore {
  readonly dir: string
  constructor(dataDir: string) {
    this.dir = join(dataDir, 'prompts')
  }

  pathFor(botId: string): string {
    if (!BOT_ID.test(botId)) throw new Error('Invalid bot id for prompt store.')
    return join(this.dir, `${botId}.txt`)
  }

  /** Atomically writes the assembled prompt for `botId` with private permissions, skipping unchanged writes. */
  write(botId: string, prompt: string): string {
    if (!prompt.trim()) throw new Error('Refusing to write an empty system prompt.')
    const file = this.pathFor(botId)
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    chmodSync(this.dir, 0o700)
    if (existsSync(file)) {
      try {
        if (readFileSync(file, 'utf8') === prompt) {
          chmodSync(file, 0o600)
          return file
        }
      } catch {
        // Rewrite cleanly if the existing copy could not be read.
      }
    }
    const tmp = `${file}.tmp.${process.pid}.${randomUUID()}`
    try {
      writeFileSync(tmp, prompt, { encoding: 'utf8', mode: 0o600 })
      chmodSync(tmp, 0o600)
      renameSync(tmp, file)
    } catch (error) {
      rmSync(tmp, { force: true })
      throw error
    }
    return file
  }

  /** Removes a deleted bot's prompt file cleanly; safe to repeat when already absent. */
  forgetBot(botId: string): void {
    if (!BOT_ID.test(botId)) return
    rmSync(join(this.dir, `${botId}.txt`), { force: true })
  }
}
