/** Limits apply across restarts. Each request reserves a slot for its answer. `concurrent` is how many deliveries run
 *  at once across all bots; `openPerBot` is how many exchanges one bot may have under way. */
export const THREAD_LIMITS = { depth: 3, messages: 20, text: 20_000, concurrent: 6, openPerBot: 8 } as const

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
