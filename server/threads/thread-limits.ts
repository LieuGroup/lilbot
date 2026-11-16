/** Limits apply across restarts. Each request reserves a slot for its answer. */
export const THREAD_LIMITS = { depth: 3, messages: 20, text: 20_000, concurrent: 2 } as const
