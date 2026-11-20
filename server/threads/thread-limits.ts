/** Limits apply across restarts. Each request reserves a slot for its answer. `concurrent` is how many deliveries run
 *  at once across all bots; `openPerBot` is how many exchanges one bot may have under way. */
export const THREAD_LIMITS = { depth: 3, messages: 20, text: 20_000, concurrent: 6, openPerBot: 8 } as const
