/** Reports why a bot cannot switch engines right now (active turn, routine, webhook, worker, exchange, group or check). */
import type { Database } from 'bun:sqlite'
import type { ActivityService } from './activity/activity-service'
import type { RoutineStore } from './routines/routine-store'
import type { WebhookStore } from './webhooks/webhook-store'

interface BusySources {
  database: Database
  activity: ActivityService
  routineStore: RoutineStore
  webhookStore: WebhookStore
}

export function botBusyReason({ database, activity, routineStore, webhookStore }: BusySources) {
  return (botId: string): string | null => {
    if (activity.state(botId).status === 'working') return 'This bot has an active turn running.'
    if (routineStore.pending().some(run => run.botId === botId)) return 'This bot has a routine run in progress.'
    if (webhookStore.pending().some(run => run.botId === botId)) return 'This bot has a webhook run in progress.'
    if (database.query("SELECT 1 FROM thread_deliveries WHERE status != 'done' AND (sender = ? OR target = ?) LIMIT 1").get(botId, botId))
      return 'This bot has an active exchange or worker.'
    const groups = database.query('SELECT g.leader_id, t.data FROM thread_groups g JOIN threads t ON t.id = g.thread_id WHERE g.ended_at IS NULL OR g.settled = 0').all() as {
      leader_id: string
      data: string
    }[]
    for (const group of groups) {
      if (group.leader_id === botId) return 'This bot is in an active group.'
      const participants = (JSON.parse(group.data).participants ?? []) as { id: string }[]
      if (participants.some(p => p.id === botId)) return 'This bot is in an active group.'
    }
    if (database.query("SELECT 1 FROM work_checks WHERE checker_kind = 'bot' AND checker_id = ? AND state = 'checking' LIMIT 1").get(botId))
      return 'This bot is checking a work item.'
    return null
  }
}
