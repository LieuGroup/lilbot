/** Wires LilBot's engine-neutral notification service to conversation turns, work items, goals, and deploy notices. */
import type { Database } from 'bun:sqlite'
import type { EventFrame } from '../shared/protocol'
import type { ConversationHooks } from './bots/bot-conversations'
import type { BotStore } from './bots/bot-store'
import { deployNoticeJob } from './deploy/deploy-notice'
import type { DeviceService } from './devices/device-service'
import type { StoredGoal } from './goals/goal-store'
import { type NotificationSender, routeSenders } from './notifications/notification-sender'
import { NotificationService } from './notifications/notification-service'
import { NotificationStore } from './notifications/notification-store'
import type { Saved } from './work/work-service'

interface AppNotificationsDeps {
  database: Database
  devices: DeviceService
  store: BotStore
  dataDir: string
  publish: (frame: EventFrame) => void
  sender?: NotificationSender
}

const fire = (label: string, run: () => Promise<unknown>) => {
  void run().catch(() => console.error(`[notifications] ${label} failed`))
}

export function createNotifications({ database, devices, store, dataDir, publish, sender }: AppNotificationsDeps) {
  const notifications = new NotificationService(new NotificationStore(database), sender ?? routeSenders([]), {
    deviceExists: id => devices.exists(id),
    botName: id => (store.exists(id) ? store.get(id).name : 'LilBot'),
    botExists: id => store.exists(id),
    changed: () => publish({ event: 'notifications.changed' })
  })

  notifications.prune()
  const notice = deployNoticeJob(dataDir)
  if (notice) fire('deploy failure', () => notifications.notifyDeployFailure(notice))

  const conversationHooks = (base: ConversationHooks, hiddenChat: (botId: string, chatId: string) => boolean): ConversationHooks => ({
    ...base,
    onTurnStarted: (botId, chatId) => {
      base.onTurnStarted?.(botId, chatId)
      if (store.exists(botId) && !hiddenChat(botId, chatId)) notifications.noteTurnStarted(botId, chatId)
    },
    onTurnFinished: (botId, chatId, event, key) => {
      base.onTurnFinished?.(botId, chatId, event, key)
      if (!store.exists(botId) || hiddenChat(botId, chatId)) return
      const keyPart = event.rowId ?? key ?? crypto.randomUUID()
      if (event.status === 'completed' && event.text.trim()) {
        fire('reply', () => notifications.notifyReply({ botId, chatId, text: event.text, dedupeKey: `reply:${botId}:${chatId}:${keyPart}` }))
      } else if (event.status === 'failed') {
        fire('turn failed', () => notifications.notifyTurnFailed({ botId, chatId, reason: event.failure, dedupeKey: `turn_failed:${botId}:${chatId}:${keyPart}` }))
      }
    }
  })

  const onWorkStatus = ({ item, asked, finished }: Saved) => {
    if (asked !== null) fire('work needs answer', () => notifications.notifyWorkNeedsAnswer(item, asked))
    if (finished !== null && finished !== undefined) fire('work finished', () => notifications.notifyWorkFinished(item, finished))
  }

  const onGoalWaiting = (goal: StoredGoal, event: number) => {
    fire('goal waiting', () => notifications.notifyGoalWaiting(goal, event))
  }

  return { notifications, conversationHooks, onWorkStatus, onGoalWaiting }
}
