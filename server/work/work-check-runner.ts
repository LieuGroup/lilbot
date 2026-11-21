/** The checks bots are asked to do, run as hidden sessions of the checking bot. The check is saved before it runs and its
 *  run id is stable, so a retry after a transport failure or a restart reaches the same engine admission instead of a
 *  second check. */
import type { BotModel } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { RetryQueue } from '../background'
import { checkPrompt } from './work-check-prompts'
import type { WorkService } from './work-service'

/** Runs `prompt` as a new hidden session of the bot, on `model` when one is given (else the bot's own); `onChat` is told the
 *  session's ids before the prompt is submitted. */
export type CheckRun = (botId: string, prompt: string, runId: string, onChat: (chatId: string) => void, model?: BotModel) => Promise<{ status: string }>

export class WorkCheckRunner {
  private retries = new RetryQueue('work check')
  constructor(
    private work: WorkService,
    private run: CheckRun,
    /** The checking bot shows as working while its check runs. */
    private activity: (botId: string, checkId: string, working: boolean) => void,
    /** A bot's own folder. */
    private folder: (botId: string) => string
  ) {}

  tick() {
    for (const check of this.work.checks.running()) {
      if (!this.retries.ready(check.id) || check.by.kind !== 'bot') continue
      const item = this.work.store.get(check.itemId)
      if (item?.status !== 'checking') {
        this.work.checking.ended(check.id, 'The item is no longer waiting for a check.')
        continue
      }
      const botId = check.by.id
      const prompt = checkPrompt(item, this.work.store.evidence(item.id), this.folder(item.ownerId), check)
      this.retries.run(
        check.id,
        async () => {
          this.activity(botId, check.id, true)
          const result = await this.run(botId, prompt, `check-${check.id}`, chatId => this.work.checks.attach(check.id, chatId), check.model ?? undefined)
          if (this.work.checks.get(check.id)?.state === 'checking')
            console.warn(`[work-check] check ended without a verdict (${result.status}, ${check.sameBot ? 'same bot' : 'second bot'})`)
          this.work.checking.ended(check.id, `The check ended (${result.status}) without a verdict.`)
        },
        {
          onError: error => {
            if (!(error instanceof LilBotError && error.code === 'bot_not_found')) return false
            this.work.checking.ended(check.id, `${check.by.name} is no longer available to check it.`)
            return true
          },
          onFinally: () => this.activity(botId, check.id, false)
        }
      )
    }
  }
}
