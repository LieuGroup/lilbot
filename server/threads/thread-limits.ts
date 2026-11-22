/** Limits apply across restarts. Each request reserves a slot for its answer. `concurrent` is how many work deliveries run
 *  at once across all bots (`concurrentWorkers` of them workers, at most `workersPerComputer` per remote computer; answers
 *  and notices are never starved); `openPerBot` is how many exchanges one bot may have under way (`workersPerBot` of them workers). */
export const THREAD_LIMITS = { depth: 3, messages: 20, text: 20_000, concurrent: 6, openPerBot: 8, workersPerBot: 3, concurrentWorkers: 4, workersPerComputer: 2 } as const

export const isReply = (kind: string) => kind === 'answer' || kind === 'notice'
const isExchangeWork = (kind: string) => kind === 'request' || kind === 'redirect' || kind === 'oscar'

/** Work deliveries share `concurrent` (workers share `concurrentWorkers` and `workersPerComputer` per remote computer);
 *  answers and notices are never starved. */
export function canStartDelivery(
  d: { kind: string; threadId: string },
  running: Iterable<{ kind: string; threadId: string }>,
  threadOf: (threadId: string) => { worker?: boolean; computer?: string },
  activeRemoteThreads?: (computerId: string) => Iterable<string>
) {
  if (isReply(d.kind)) return true
  const info = threadOf(d.threadId)
  const targetWorker = isExchangeWork(d.kind) && !!info.worker
  const targetComputer = targetWorker ? info.computer : undefined
  let work = 0
  let workers = 0
  const remoteOnComputer = new Set<string>()
  for (const r of running) {
    if (isReply(r.kind)) continue
    work++
    if (isExchangeWork(r.kind)) {
      const rInfo = threadOf(r.threadId)
      if (rInfo.worker) {
        workers++
        if (targetComputer && targetComputer !== 'leader' && rInfo.computer === targetComputer) remoteOnComputer.add(r.threadId)
      }
    }
  }
  if (work >= THREAD_LIMITS.concurrent) return false
  if (targetWorker && workers >= THREAD_LIMITS.concurrentWorkers) return false
  if (targetComputer && targetComputer !== 'leader') {
    const restored = activeRemoteThreads ? [...activeRemoteThreads(targetComputer)] : []
    for (const id of restored) remoteOnComputer.add(id)
    if (!restored.includes(d.threadId) && remoteOnComputer.size >= THREAD_LIMITS.workersPerComputer) return false
  }
  return true
}

/** Temporary groups: `members` besides the leader; a group ends by itself after `rounds` rounds, `messages` messages
 *  (points and replies), `minutes` from its start, or `quietMinutes` without a point while nothing runs. A bot leads at
 *  most `perBot` running groups. Prompts carry each earlier message cut to `shown` characters. */
export const GROUP_LIMITS = { members: 4, rounds: 6, messages: 40, minutes: 120, quietMinutes: 15, perBot: 2, shown: 6000 }
export type GroupLimits = typeof GROUP_LIMITS

/** A development server's checks may lower the round limit: needs the isolated data folder and bot allowlist, as the
 *  routines' test interval does; production refuses any `LILBOT_*_TEST_*` setting. */
export function groupLimits(env: Record<string, string | undefined>): GroupLimits {
  const rounds = env.LILBOT_DATA_DIR && env.LILBOT_BOT_IDS && env.LILBOT_GROUP_TEST_ROUNDS
  return rounds ? { ...GROUP_LIMITS, rounds: Math.max(1, Number(rounds)) } : GROUP_LIMITS
}
