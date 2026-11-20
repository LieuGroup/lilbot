export async function checkClient(port: number, onEvent: (frame: any) => void, timeout?: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = reject
  })
  let seq = 0
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  socket.onmessage = event => {
    const frame = JSON.parse(String(event.data))
    if (frame.event) return onEvent(frame)
    const waiter = pending.get(frame.id)
    pending.delete(frame.id)
    if (frame.ok) waiter?.resolve(frame.result)
    else waiter?.reject(new Error(JSON.stringify(frame.error)))
  }
  const call = (method: string, params = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++seq
      const timer = timeout
        ? setTimeout(() => {
            pending.delete(id)
            reject(new Error(`Timed out: ${method}`))
          }, timeout).unref()
        : undefined
      pending.set(id, {
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        }
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
  return { socket, call }
}
