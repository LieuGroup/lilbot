/** Wires LilBot's engine-neutral notification service to conversation turns, work items, goals, and deploy notices.
 *  Every hook and startup step is guarded so a broken notification store or sender never crashes boot or hot paths. */
import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
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
  isMainChat: (botId: string, chatId: string) => boolean
  publish: (frame: EventFrame) => void
  sender?: NotificationSender
}

const safe = (label: string, run: () => void) => {
  try {
    run()
  } catch {
    console.error(`[notifications] ${label} failed`)
  }
}

const fire = (label: string, run: () => Promise<unknown>) => {
  try {
    void Promise.resolve(run()).catch(() => console.error(`[notifications] ${label} failed`))
  } catch {
    console.error(`[notifications] ${label} failed`)
  }
}

function turnFingerprint(status: string, failure: string | undefined, text: string): string {
  const digest = createHash('sha256').update(text.slice(0, 1000)).digest('hex').slice(0, 16)
  return `${status}:${failure ?? ''}:${digest}`
}

export function createNotifications({ database, devices, store, dataDir, isMainChat, publish, sender }: AppNotificationsDeps) {
  const notifications = new NotificationService(new NotificationStore(database), sender ?? routeSenders([]), {
    deviceExists: id => devices.exists(id),
    botName: id => (store.exists(id) ? store.get(id).name : 'LilBot'),
    botExists: id => store.exists(id),
    changed: () => publish({ event: 'notifications.changed' })
  })

  const prune = () => safe('prune', () => notifications.prune())
  prune()
  safe('deploy failure', () => {
    const notice = deployNoticeJob(dataDir)
    if (notice) fire('deploy failure', () => notifications.notifyDeployFailure(notice))
  })

  const conversationHooks = (base: ConversationHooks, hiddenChat: (botId: string, chatId: string) => boolean): ConversationHooks => ({
    ...base,
    onTurnStarted: (botId, chatId) => {
      base.onTurnStarted?.(botId, chatId)
      safe('turn started', () => {
        if (store.exists(botId) && isMainChat(botId, chatId) && !hiddenChat(botId, chatId)) notifications.noteTurnStarted(botId, chatId)
      })
    },
    onTurnFinished: (botId, chatId, event, key) => {
      base.onTurnFinished?.(botId, chatId, event, key)
      safe('turn finished', () => {
        if (!store.exists(botId) || !isMainChat(botId, chatId) || hiddenChat(botId, chatId)) return
        const fingerprint = turnFingerprint(event.status, event.failure, event.text)
        const keyPart = event.rowId ? `row:${event.rowId}` : key ? `evt:${key}` : undefined
        if (event.status === 'completed' && event.text.trim()) {
          const dedupeKey = keyPart ? `reply:${chatId}:${keyPart}` : undefined
          fire('reply', () => notifications.notifyReply({ botId, chatId, text: event.text, dedupeKey, fingerprint }))
        } else if (event.status === 'failed') {
          const dedupeKey = keyPart ? `turn_failed:${chatId}:${keyPart}` : undefined
          fire('turn failed', () => notifications.notifyTurnFailed({ botId, chatId, reason: event.failure, dedupeKey, fingerprint }))
        }
      })
    }
  })

  const onWorkStatus = ({ item, asked, finished }: Saved) => {
    if (asked !== null) fire('work needs answer', () => notifications.notifyWorkNeedsAnswer(item, asked))
    if (finished !== null && finished !== undefined) fire('work finished', () => notifications.notifyWorkFinished(item, finished))
  }

  const onGoalWaiting = (goal: StoredGoal, event: number) => {
    fire('goal waiting', () => notifications.notifyGoalWaiting(goal, event))
  }

  const forgetBot = (botId: string) => safe('forget bot', () => notifications.forgetBot(botId))

  return { notifications, conversationHooks, onWorkStatus, onGoalWaiting, forgetBot, prune }
}
