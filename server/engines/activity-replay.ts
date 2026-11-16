import type { ActivityEvent } from '../../shared/activity-schema'

export interface ActivityReplayState {
  epoch: string
  sequence: number
  status: ActivityEvent['status']
  tool?: string
}
export interface ActivityUpdate {
  sequence: number
  status?: ActivityEvent['status']
  tool?: string
  clearTool?: boolean
  spoke?: boolean
}

/** A complete baseline is needed after restart, even when a durable cursor exists. */
export function replayPosition(state?: ActivityReplayState) {
  return { last_sequence: state?.sequence ?? 0, ...(state ? { replay_epoch: state.epoch } : {}) }
}

export function replayNeedsReset(state: ActivityReplayState | undefined, epoch: string, truncated: boolean) {
  return !!state && (state.epoch !== epoch || truncated)
}

/** Preserve the current tool/status across empty and partial replay batches. */
export function applyActivityReplay(
  previous: ActivityReplayState | undefined,
  batch: { epoch: string; sequence: number; updates: ActivityUpdate[]; running: boolean; waiting: boolean },
  saved?: string
): { state: ActivityReplayState; spoke: boolean } {
  const [savedEpoch, savedSequence] = saved?.split(':') ?? []
  const cutoff = previous?.epoch === batch.epoch ? previous.sequence : savedEpoch === batch.epoch ? Number(savedSequence) : 0
  const state: ActivityReplayState = { epoch: batch.epoch, sequence: batch.sequence, status: previous?.status ?? (batch.running ? 'working' : 'idle'), tool: previous?.tool }
  let spoke = false
  for (const update of batch.updates) {
    if (update.status) state.status = update.status
    if (update.clearTool) state.tool = undefined
    if (update.tool) state.tool = update.tool
    if (update.sequence > cutoff) spoke ||= !!update.spoke
  }
  if (batch.waiting) state.status = 'waiting'
  else if (state.status === 'waiting') state.status = batch.running ? 'working' : 'idle'
  return { state, spoke }
}
