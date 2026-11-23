/** Guard timer callbacks, including returned promises. Never log arbitrary error payloads. */
import { LilBotError } from '../shared/lilbot-error'

export function backgroundTask(label: string, task: () => unknown): () => void {
  return () => {
    try {
      void Promise.resolve(task()).catch(() => backgroundFailure(label))
    } catch {
      backgroundFailure(label)
    }
  }
}

export function backgroundFailure(label: string) {
  console.error(`[background] ${label} failed; will retry on the next tick.`)
}

type RetryHooks = { onError?: (error: unknown) => boolean | Promise<boolean>; onFinally?: () => unknown }

/** Tracks in-flight background runs and per-id 30s retry backoff after transient failures. */
export class RetryQueue<T = true> {
  readonly running = new Map<string, T>()
  private retryAt = new Map<string, number>()
  constructor(
    private label: string,
    private now: () => number = Date.now,
    private delayMs = 30_000
  ) {}
  ready = (id: string) => !this.running.has(id) && (this.retryAt.get(id) ?? 0) <= this.now()
  clear = (id: string) => void this.retryAt.delete(id)
  retry = (id: string) => void this.retryAt.set(id, this.now() + this.delayMs)
  run(id: string, task: () => unknown, ...rest: T extends true ? [hooks?: RetryHooks] : [hooks: RetryHooks & { value: T }]) {
    const hooks = rest[0] as (RetryHooks & { value?: T }) | undefined
    this.running.set(id, (hooks?.value ?? true) as T)
    void new Promise(resolve => resolve(task()))
      .then(
        () => this.clear(id),
        async error => {
          if (await hooks?.onError?.(error)) return this.clear(id)
          this.retry(id)
          backgroundFailure(this.label)
        }
      )
      .finally(() => {
        this.running.delete(id)
        return hooks?.onFinally?.()
      })
      .catch(() => backgroundFailure(`${this.label} cleanup`))
  }
}

const STOP_CONFIRM_TIMEOUT_MS = 15_000
const STOP_CONFIRM_POLL_MS = 500
const GONE_CODES = new Set(['session_not_found', 'bot_not_found'])

/** Confirms a session has no running turn after an unknown outcome or post-restart cancel: invokes `stopRun`
 *  (which interrupts if running and returns `false` once idle) until it reports nothing running or confirms the
 *  session/bot is gone. Throws `run_still_active` if still running after `timeoutMs` so the caller keeps the row
 *  open (and gating armed) and retries on the next tick without ever re-submitting the turn. */
export async function confirmStopped(
  stopRun: (() => Promise<boolean>) | undefined,
  opts: { timeoutMs?: number; pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<void> {
  if (!stopRun) return
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? (ms => Bun.sleep(ms))
  const timeoutMs = opts.timeoutMs ?? STOP_CONFIRM_TIMEOUT_MS
  const pollMs = opts.pollMs ?? STOP_CONFIRM_POLL_MS
  const deadline = now() + timeoutMs
  for (;;) {
    try {
      if (!(await stopRun())) return
    } catch (error) {
      if (error instanceof LilBotError && GONE_CODES.has(error.code)) return
      throw error
    }
    const left = deadline - now()
    if (left <= 0) throw new LilBotError('run_still_active', 'Could not confirm the running turn stopped in time.')
    await sleep(Math.min(pollMs, left))
  }
}
