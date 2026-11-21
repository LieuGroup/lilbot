export interface WaitForOptions {
  /** Human-readable description appended to the default timeout error (`Timed out waiting for <label>`). */
  label?: string
  /** Full custom timeout error message, overriding `label`. */
  error?: string
  /** Maximum wait time in milliseconds (default: 240_000). */
  timeout?: number
  /** Polling interval in milliseconds (default: 250). */
  interval?: number
}

/** Polls `read` every `interval` ms until `matches(value)` returns true or `timeout` elapses. */
export async function waitFor<T>(read: () => Promise<T> | T, matches: (value: T) => boolean, options: WaitForOptions = {}): Promise<T> {
  const { timeout = 240_000, interval = 250, label, error } = options
  for (const end = Date.now() + timeout; Date.now() < end; await Bun.sleep(interval)) {
    const value = await read()
    if (matches(value)) return value
  }
  throw new Error(error ?? (label ? `Timed out waiting for ${label}` : 'Timed out'))
}
