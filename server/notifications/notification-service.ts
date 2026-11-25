/** Coordinates device registrations, preferences, expiring presence, quiet grouping, bounded queuing, deduplication, and delivery. */
import type { Goal } from '../../shared/goal-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type {
  NotificationBotPrefs,
  NotificationChannel,
  NotificationDevicePrefs,
  NotificationEndpoint,
  NotificationPrefsPatch,
  NotificationSettings
} from '../../shared/notification-schema'
import type { WorkSummary } from '../../shared/work-schema'
import type { Deployment } from '../deploy/deploy-state'
import { type DispatchOptions, type DispatchSummary, dispatchNotification } from './notification-dispatch'
import { DEFAULT_PRESENCE_TTL_MS, DevicePresence } from './notification-presence'
import { DeliveryQueue, type DeliveryQueueOptions } from './notification-queue'
import { DEFAULT_LONG_WORK_MS, DEFAULT_REPLY_COOLDOWN_MS, ReplyCooldown, shouldNotifyWorkDone, TurnAlertTracker } from './notification-rules'
import type { NotificationSender } from './notification-sender'
import type { NotificationStore } from './notification-store'
import type { NotificationEvent } from './notification-text'

const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60_000
const DEFAULT_MAX_DELIVERY_ROWS = 10_000
const SKIP_SUPPRESSED: DispatchSummary = { sent: 0, suppressed: 1, deduped: 0, failed: 0 }

export interface NotificationServiceOptions extends DeliveryQueueOptions {
  deviceExists: (deviceId: string) => boolean
  botName: (botId: string) => string
  botExists?: (botId: string) => boolean
  changed?: () => void
  now?: () => number
  longWorkMs?: number
  replyCooldownMs?: number
  presenceTtlMs?: number
  maxDeliveryRows?: number
}

export class NotificationService {
  readonly presence: DevicePresence
  private queue: DeliveryQueue
  private turns = new TurnAlertTracker()
  private cooldown = new ReplyCooldown()
  private now: () => number

  constructor(
    private store: NotificationStore,
    private sender: NotificationSender,
    private opts: NotificationServiceOptions
  ) {
    this.now = opts.now ?? Date.now
    this.presence = new DevicePresence(this.now, opts.presenceTtlMs ?? DEFAULT_PRESENCE_TTL_MS)
    this.queue = new DeliveryQueue(opts)
  }

  private requireDevice(deviceId: string) {
    if (!this.opts.deviceExists(deviceId)) throw new LilBotError('device_not_found', 'This device is not known. Reload the page.')
  }

  private send(event: NotificationEvent, options?: DispatchOptions): Promise<DispatchSummary> {
    const replyCooldownMs = this.opts.replyCooldownMs ?? DEFAULT_REPLY_COOLDOWN_MS
    return dispatchNotification(
      { store: this.store, sender: this.sender, queue: this.queue, presence: this.presence, cooldown: this.cooldown, replyCooldownMs, now: this.now() },
      event,
      options
    )
  }

  register(deviceId: string, channel: NotificationChannel, token: string, bundleId = ''): NotificationEndpoint {
    this.requireDevice(deviceId)
    const endpoint = this.store.register(deviceId, channel, token, bundleId, this.now())
    this.opts.changed?.()
    return endpoint
  }

  unregister(deviceId: string, channel?: NotificationChannel): { ok: true } {
    this.requireDevice(deviceId)
    if (this.store.unregister(deviceId, channel) > 0) this.opts.changed?.()
    return { ok: true }
  }

  getSettings(deviceId: string): NotificationSettings {
    this.requireDevice(deviceId)
    return { device: this.store.devicePrefs(deviceId), endpoints: this.store.endpointsForDevice(deviceId), mutedBotIds: this.store.mutedBotIds() }
  }

  setDevicePrefs(deviceId: string, patch: NotificationPrefsPatch): NotificationDevicePrefs {
    this.requireDevice(deviceId)
    const prefs = this.store.setDevicePrefs(deviceId, patch, this.now())
    this.opts.changed?.()
    return prefs
  }

  setBotPrefs(botId: string, muted: boolean): NotificationBotPrefs {
    if (this.opts.botExists && !this.opts.botExists(botId)) throw new LilBotError('bot_not_found', 'This bot does not exist.')
    const prefs = this.store.setBotMuted(botId, muted, this.now())
    this.opts.changed?.()
    return prefs
  }

  setPresence(connectionId: string, deviceId: string, foreground: boolean, botId?: string | null): { ok: true } {
    this.requireDevice(deviceId)
    this.presence.setPresence(connectionId, deviceId, foreground, botId)
    if (foreground && botId) this.cooldown.clearBot(botId, deviceId, this.now())
    return { ok: true }
  }

  viewBot(connectionId: string, botId: string, deviceId?: string | null) {
    this.presence.viewBot(connectionId, botId, deviceId)
    if (deviceId) this.cooldown.clearBot(botId, deviceId, this.now())
  }

  markRead = (botId: string, deviceId?: string) => this.cooldown.clearBot(botId, deviceId, this.now())
  noteTurnStarted = (botId: string, chatId: string) => this.turns.turnStarted(botId, chatId)

  notifyReply(input: { botId: string; chatId: string; text: string; at?: number; dedupeKey: string }): Promise<DispatchSummary> {
    const suppressedDevices = this.turns.finishTurn(input.botId, input.chatId)
    return this.send(
      {
        kind: 'reply',
        botId: input.botId,
        botName: this.opts.botName(input.botId),
        chatId: input.chatId,
        text: input.text,
        at: input.at ?? this.now(),
        dedupeKey: input.dedupeKey
      },
      { suppressedDevices }
    )
  }

  notifyTurnFailed(input: { botId: string; chatId: string; reason?: 'memory_save'; at?: number; dedupeKey: string }): Promise<DispatchSummary> {
    this.turns.finishTurn(input.botId, input.chatId)
    return this.send({
      kind: 'turn_failed',
      botId: input.botId,
      botName: this.opts.botName(input.botId),
      chatId: input.chatId,
      reason: input.reason,
      at: input.at ?? this.now(),
      dedupeKey: input.dedupeKey
    })
  }

  notifyWorkNeedsAnswer(item: WorkSummary, eventSeq: number): Promise<DispatchSummary> {
    const botName = this.opts.botName(item.ownerId) || item.ownerName
    return this.send({
      kind: 'needs_answer',
      source: 'work',
      botId: item.ownerId,
      botName,
      workItemId: item.id,
      title: item.title,
      question: item.question,
      at: item.updatedAt,
      dedupeKey: `work:needs_answer:${item.id}:${eventSeq}`
    })
  }

  notifyWorkFinished(item: WorkSummary & { chatId?: string | null }, eventSeq: number): Promise<DispatchSummary> {
    if (!shouldNotifyWorkDone(item, this.opts.longWorkMs ?? DEFAULT_LONG_WORK_MS)) return Promise.resolve({ ...SKIP_SUPPRESSED })
    const status = item.status === 'failed' ? 'failed' : 'done'
    const inConversation = item.origin.kind === 'conversation'
    const chatId = inConversation ? (item.chatId ?? item.origin.id) : null
    const botName = this.opts.botName(item.ownerId) || item.ownerName
    const dedupeKey = `work:done:${item.id}:${eventSeq}`
    return this.send(
      { kind: 'work_done', botId: item.ownerId, botName, workItemId: item.id, title: item.title, status, chatId, at: item.finishedAt ?? item.updatedAt, dedupeKey },
      {
        suppressWhenViewing: inConversation,
        onReserved: ids => chatId && this.turns.recordWorkAlerted(item.ownerId, chatId, ids),
        onFailed: deviceId => chatId && this.turns.releaseWorkAlerted(item.ownerId, chatId, deviceId)
      }
    )
  }

  notifyGoalWaiting(goal: Goal, eventSeq: number): Promise<DispatchSummary> {
    const botName = this.opts.botName(goal.botId) || goal.botName
    const dedupeKey = `goal:needs_answer:${goal.id}:${eventSeq}`
    return this.send({ kind: 'needs_answer', source: 'goal', botId: goal.botId, botName, goalId: goal.id, title: goal.text, at: goal.updatedAt, dedupeKey })
  }

  notifyDeployFailure(job: Pick<Deployment, 'id' | 'status' | 'startedAt' | 'finishedAt'>): Promise<DispatchSummary> {
    if (job.status !== 'rolled-back' && job.status !== 'manual-recovery') return Promise.resolve({ ...SKIP_SUPPRESSED })
    const parsed = Date.parse(job.finishedAt ?? job.startedAt)
    const dedupeKey = `deploy:failed:${job.id}:${job.status}`
    return this.send({ kind: 'deploy_failed', jobId: job.id, status: job.status, at: Number.isNaN(parsed) ? this.now() : parsed, dedupeKey })
  }

  forgetBot(botId: string) {
    this.turns.forgetBot(botId)
    this.cooldown.clearBot(botId, undefined, this.now())
    this.store.forgetBot(botId)
  }

  prune(maxRows = this.opts.maxDeliveryRows ?? DEFAULT_MAX_DELIVERY_ROWS) {
    this.store.pruneDeliveries(this.now() - DELIVERY_RETENTION_MS, maxRows)
  }
}
