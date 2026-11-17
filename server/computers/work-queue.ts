/** Serialize one computer's payload work, yielding between expensive turns. */
export function payloadQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(action: () => T | Promise<T>): Promise<T> => {
    const result = tail.then(action)
    tail = result.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, 10)))
    return result
  }
}
