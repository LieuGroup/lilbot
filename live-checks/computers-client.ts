/** Bounded requests and turns let the caller's finally always clean up. */
export async function eventually(check: () => Promise<boolean>, timeout = 30_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await Bun.sleep(100)
  }
  throw new Error('Condition timed out')
}
export async function browser(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket timed out')), 10_000)
    socket.onopen = () => {
      clearTimeout(timer)
      resolve()
    }
    socket.onerror = () => {
      clearTimeout(timer)
      reject(new Error('Socket failed'))
    }
  })
  let next = 0
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const toolNames = new Set<string>()
  let finished: (frame: any) => void = () => {}
  socket.onmessage = event => {
    const frame = JSON.parse(String(event.data))
    const waiter = pending.get(frame.id)
    if (waiter) {
      pending.delete(frame.id)
      clearTimeout(waiter.timer)
      if (frame.ok) waiter.resolve(frame.result)
      else waiter.reject(new Error(frame.error.message))
    }
    if (frame.event === 'chat' && frame.data.type === 'tool.started') toolNames.add(frame.data.name)
    if (frame.event === 'chat' && frame.data.type === 'turn.finished') finished(frame.data)
  }
  const call = (method: string, params = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++next
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timed out: ${method}`))
      }, 120_000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  return {
    call,
    toolNames,
    close: () => socket.close(),
    async turn(botId: string, text: string) {
      const chat = await call('chat.new', { botId })
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Computer tool turn timed out')), 150_000)
        finished = frame => (frame.status === 'completed' ? resolve() : reject(new Error('Computer tool turn failed')))
      })
      try {
        await call('chat.send', { chatId: chat.chatId, text })
        await done
      } finally {
        clearTimeout(timer)
        finished = () => {}
        await call('chat.close', { chatId: chat.chatId })
      }
    }
  }
}
export function freePort() {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') })
  const port = server.port!
  server.stop(true)
  return port
}
