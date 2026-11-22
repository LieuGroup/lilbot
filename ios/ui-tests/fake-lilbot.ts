/// <reference types="bun" />
/** A stand-in LilBot server for the iOS UI tests: just enough of the socket protocol for the app
 *  to show its roster and chat. It never touches production or a real bot — it answers from memory. */

const BOT = {
  id: 'bot-test-1',
  name: 'Test Bot',
  function: 'Answers UI tests.',
  model: null,
  reasoningEffort: null,
  permissionMode: 'full-access',
  isDefault: false,
  isPrimary: true,
  runnable: true,
  activity: { status: 'idle', text: '', machine: 'leader', unread: false },
  prefs: { avatar: { shape: 'squircle', color: 'blue', faceColor: 'ink' }, sectionId: null, pinned: true, pinnedAt: 1, hidden: false },
  workspace: '/tmp/lilbot-test'
}

const SECTIONS = [{ id: 'section-1', name: 'Test section' }]

const SNAPSHOT = (botId: string, chatId: string) => ({
  chatId,
  botId,
  title: 'Test chat',
  running: false,
  workspace: '/tmp/lilbot-test',
  items: [
    { kind: 'user', text: 'Hello from the test', messageId: 'm-1' },
    { kind: 'assistant', text: 'Hello! I am the fake LilBot server.' }
  ]
})

function handle(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case 'devices.current':
      return { id: params.deviceId, name: params.name, computerId: null, resolves: { via: 'none' } }
    case 'bots.list':
      return [BOT]
    case 'sections.list':
      return SECTIONS
    case 'chat.history':
      return { items: [], nextCursor: null, start: null, import: { complete: true, sessions: 0, completed: 0, items: 0 } }
    case 'chat.open':
    case 'chat.new':
      return SNAPSHOT(String(params.botId), `chat-${params.botId}`)
    case 'chat.send':
      return { ok: true }
    case 'chat.stop':
    case 'chat.close':
      return { ok: true }
    default:
      throw new Error(`fake LilBot: unknown method ${method}`)
  }
}

const port = Number(process.env.PORT ?? 3399)

Bun.serve({
  port,
  fetch(request, server) {
    if (server.upgrade(request)) return
    return new Response('fake LilBot for iOS UI tests', { status: 200 })
  },
  websocket: {
    message(socket, message) {
      const frame = JSON.parse(String(message)) as { id: number; method: string; params: Record<string, unknown> }
      try {
        socket.send(JSON.stringify({ id: frame.id, ok: true, result: handle(frame.method, frame.params) }))
      } catch (error) {
        socket.send(JSON.stringify({ id: frame.id, ok: false, error: { code: 'failed', message: error instanceof Error ? error.message : 'failed' } }))
      }
    }
  }
})

console.log(`fake LilBot listening on http://localhost:${port}`)
