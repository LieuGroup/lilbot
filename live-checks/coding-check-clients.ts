/** Small clients for the coding live check: LilBot's browser socket and an MCP client that talks to
 *  T3 Code through a test server's bridge (with a temporary bot's own key). */

export async function lilbotSocket(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('LilBot socket failed'))
  })
  let nextId = 0
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  const finished = new Map<string, (event: any) => void>()
  socket.onmessage = event => {
    const frame = JSON.parse(String(event.data))
    if (frame.id) {
      const waiter = pending.get(frame.id)
      pending.delete(frame.id)
      if (frame.ok) waiter?.resolve(frame.result)
      else waiter?.reject(new Error(frame.error.message))
    }
    if (frame.event === 'chat' && frame.data.type === 'turn.finished') finished.get(frame.chatId)?.(frame.data)
  }
  const call = (method: string, params = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  /** Sends one message in the bot's main conversation and returns the bot's reply text. */
  const turn = async (botId: string, chatId: string, text: string, timeoutMs: number) => {
    const done = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Turn timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      finished.set(chatId, event => {
        clearTimeout(timer)
        resolve(event)
      })
    })
    await call('chat.send', { chatId, text })
    const result = await done
    if (result.status !== 'completed') throw new Error(`Turn ended ${result.status}`)
    const snapshot = await call('chat.open', { botId, chatId })
    const replies = snapshot.items.filter((item: any) => item.kind === 'assistant')
    return String(replies.at(-1)?.text ?? '')
  }
  return { call, turn, close: () => socket.close() }
}

/** Parses a JSON or event-stream MCP answer into its JSON-RPC message. */
async function rpcBody(response: Response): Promise<any> {
  const text = await response.text()
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) return text ? JSON.parse(text) : null
  const data = text
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => JSON.parse(line.slice(5)))
  return data.find(message => 'result' in message || 'error' in message) ?? null
}

export async function bridgeClient(url: string, key: string) {
  let session: string | null = null
  let nextId = 0
  const post = async (method: string, params?: unknown) => {
    const id = method.startsWith('notifications/') ? undefined : ++nextId
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        ...(session ? { 'mcp-session-id': session } : {})
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, ...(params ? { params } : {}) }),
      signal: AbortSignal.timeout(120_000)
    })
    session = response.headers.get('mcp-session-id') ?? session
    if (id === undefined) return null
    const message = await rpcBody(response)
    if (message?.error) throw new Error(`${method}: ${message.error.message}`)
    return message?.result
  }
  await post('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lilbot-coding-check', version: '1' } })
  await post('notifications/initialized')
  /** Calls a tool; returns its structured result, or its text when it has none. */
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await post('tools/call', { name, arguments: args })
    const text = String(result?.content?.[0]?.text ?? '')
    if (result?.isError) throw new Error(`${name}: ${text.slice(0, 300)}`)
    if (result?.structuredContent) return result.structuredContent
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  const toolNames = async () => ((await post('tools/list'))?.tools ?? []).map((t: any) => String(t.name)) as string[]
  return { tool, toolNames, raw: post }
}
