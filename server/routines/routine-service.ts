import type { ChatEvent } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { RoutineCreate, type RoutineRun } from '../../shared/routine-schema'
import { routineLine } from '../devices/origin-line'
import type { OpenChat, RoutineOptions } from '../engines/bot-engine'
import type { RoutineStore } from './routine-store'

export interface RoutineHost {
  requireBot(id: string): Promise<unknown>
  runRoutine(botId: string, prompt: string, options: RoutineOptions): Promise<{ status: 'completed' | 'failed' | 'stopped'; text: string }>
  openChat(botId: string, chatId: string, onEvent: (event: ChatEvent) => void, requireExisting?: boolean): Promise<OpenChat>
}
export interface RoutineSettings {
  minIntervalSeconds: number
  selfCreatedCap: number
}
const defaultRoutineSettings: RoutineSettings = { minIntervalSeconds: 300, selfCreatedCap: 5 }
/** Only isolated servers with their own data folder and explicit profile allowlist may shorten the minimum interval. */
export function routineSettings(env: Record<string, string | undefined>): RoutineSettings {
  const test = env.LILBOT_DATA_DIR && env.LILBOT_BOT_IDS && env.LILBOT_ROUTINE_TEST_INTERVAL_SECONDS
  return { ...defaultRoutineSettings, minIntervalSeconds: test ? Math.max(1, Number(test)) : defaultRoutineSettings.minIntervalSeconds }
}

export class RoutineService {
  readonly kind = 'routine'
  constructor(
    readonly store: RoutineStore,
    private host: RoutineHost,
    private changed: () => void = () => {},
    private settings = defaultRoutineSettings,
    private now = Date.now
  ) {}
  async list(botId: string) {
    await this.host.requireBot(botId)
    return this.store.list(botId)
  }
  async create(botId: string, raw: RoutineCreate) {
    await this.host.requireBot(botId)
    const input = RoutineCreate.parse(raw)
    if (input.schedule.kind === 'interval' && input.schedule.seconds < this.settings.minIntervalSeconds)
      throw new LilBotError('routine_interval', `The minimum interval is ${this.settings.minIntervalSeconds} seconds.`)
    const routine = this.store.create(botId, input, this.now(), this.settings.selfCreatedCap)
    this.changed()
    return routine
  }
  async pause(botId: string, id: string, paused: boolean) {
    await this.host.requireBot(botId)
    this.store.pause(botId, id, paused, this.now())
    this.changed()
    return { ok: true as const }
  }
  async delete(botId: string, id: string) {
    await this.host.requireBot(botId)
    this.store.delete(botId, id)
    this.changed()
    return { ok: true as const }
  }
  async openRun(botId: string, id: string, onEvent: (event: ChatEvent) => void) {
    await this.host.requireBot(botId)
    const run = this.store.run(botId, id)
    this.store.get(botId, run.routineId)
    if (!run.chatId) throw new LilBotError('run_pending', 'This run has not started yet.')
    return this.host.openChat(botId, run.chatId, onEvent, true)
  }
  async run(run: RoutineRun) {
    const routine = this.store.get(run.botId, run.routineId)
    const result = await this.host.runRoutine(
      run.botId,
      `Scheduled routine (not a new message from Oscar). Carry out this task with full access, without asking for approval. Return a concise result for the Routines list; do not post it in the main chat.\n\n${routine.description}`,
      {
        runId: run.id,
        origin: { line: routineLine },
        onChat: id => {
          this.store.attach(run.id, id, this.now())
          this.changed()
        }
      }
    )
    this.store.finish(run.id, result.status, result.text, this.now())
    this.changed()
    return result
  }
}
