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
