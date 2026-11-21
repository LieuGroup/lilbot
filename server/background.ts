/** Guard timer callbacks, including returned promises. Never log arbitrary error payloads. */
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
