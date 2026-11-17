/** Keep large synchronous payload work in separate event-loop turns. */
let tail: Promise<unknown> = Promise.resolve()
export function payloadTurn<T>(action: () => T | Promise<T>): Promise<T> {
  const result = tail.then(action)
  tail = result.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, 10)))
  return result
}
