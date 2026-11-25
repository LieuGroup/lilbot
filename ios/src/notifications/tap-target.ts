/** Pure parser and navigation planner for notification taps across iPhone, Folded Duo, Unfolded Duo, and iPad. */
import { NotificationTarget } from '../../../shared/notification-schema'

export type NotificationRouteAction =
  | { kind: 'open-bot'; botId: string; pushChat: boolean; workItemId?: string; goalId?: string }
  | { kind: 'open-settings' }

/** Extracts a validated `NotificationTarget` from raw APNs / notification `data`. */
export function parseNotificationTarget(data: unknown): NotificationTarget | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const candidate = 'target' in record ? record.target : record
  const parsed = NotificationTarget.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/** Maps a notification target plus current layout into a concrete navigation action.
 *  Work and goal targets route to the owning bot until the iOS Work tab ships, carrying their ids forward. */
export function planNotificationRoute(
  target: NotificationTarget,
  layout: { splitMode: boolean; botIds: readonly string[] }
): NotificationRouteAction | null {
  if (target.kind === 'deploy') return { kind: 'open-settings' }
  if (layout.botIds.length > 0 && !layout.botIds.includes(target.botId)) return null
  if (target.kind === 'work') return { kind: 'open-bot', botId: target.botId, pushChat: !layout.splitMode, workItemId: target.workItemId }
  if (target.kind === 'goal') return { kind: 'open-bot', botId: target.botId, pushChat: !layout.splitMode, goalId: target.goalId }
  return { kind: 'open-bot', botId: target.botId, pushChat: !layout.splitMode }
}
