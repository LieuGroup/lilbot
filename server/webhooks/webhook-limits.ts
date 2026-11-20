/** What one public address may cost: request rates at the door, and how events become runs (the model quota). */
export const WEBHOOK_LIMITS = {
  /** Bigger deliveries get 413. The helper routes on the same door keep their 8 KiB. */
  bodyBytes: 256 * 1024,
  perAddressPerMinute: 120,
  perWebhookPerMinute: 60,
  /** Accepted events waiting for a run, per webhook; more get 429 until a run takes them. */
  waiting: 100,
  /** A burst is over once no event came for `quietMs`, or once its first event has waited `maxWaitMs`. */
  quietMs: 5_000,
  maxWaitMs: 60_000,
  /** Between the starts of two runs of one webhook. */
  gapMs: 60_000,
  runsPerHour: 20,
  /** Webhook runs at once, across all bots. */
  concurrent: 2,
  eventsPerRun: 20,
  /** One event and one run as the bot sees them, counted inside the fence (after escaping). A typical GitHub
   *  `pull_request` event is about 21,700 characters, so one fits uncut and a run holds two. A run's events are then
   *  about 12,000 to 16,000 tokens: under 10% of a 200,000-token window, far from the engine compressing at 50%, and
   *  most of it cached when the agent's tool rounds resend it. Events past the run's share wait for the next run. */
  eventChars: 24_000,
  runChars: 48_000,
  /** Live webhooks one bot may make, whoever asked for them (attribution comes from the bot). */
  perBot: 5,
  /** How long a delivery id is remembered to drop repeats. */
  dedupMs: 7 * 86_400_000
} as const
