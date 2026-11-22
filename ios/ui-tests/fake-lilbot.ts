/// <reference types="bun" />
/** A stand-in LilBot server for the iOS UI tests: just enough of the socket protocol for the app
 *  to show its roster, chat and the composer model picker. It never touches production or a real bot. */

type FakeModel = { provider: string; model: string }
type FakeBot = Record<string, unknown> & { id: string; model: FakeModel | null; reasoningEffort: string | null }

const PROVIDERS = [
  {
    provider: 'anthropic',
    name: 'Anthropic',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1'],
    capabilities: [
      { id: 'claude-sonnet-4-5', reasoning: true, canDisableReasoning: null },
      { id: 'claude-opus-4-1', reasoning: true, canDisableReasoning: false }
    ]
  },
  {
    provider: 'openai',
    name: 'OpenAI',
    models: ['gpt-5'],
    capabilities: [{ id: 'gpt-5', reasoning: false, canDisableReasoning: null }]
  }
]

const BOT_PREFS = { avatar: { shape: 'squircle', color: 'blue', faceColor: 'ink' }, sectionId: null, pinned: false, pinnedAt: null, hidden: false }

const BOT: FakeBot = {
  id: 'bot-test-1',
  name: 'Test Bot',
  function: 'Answers UI tests.',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  reasoningEffort: 'high',
  effectiveReasoningEffort: 'high',
  permissionMode: 'full-access',
  isDefault: false,
  isPrimary: true,
  runnable: true,
  activity: { status: 'idle', text: '', machine: 'leader', unread: false },
  prefs: BOT_PREFS,
  workspace: '/tmp/lilbot-test'
}

const SECTION_BOT: FakeBot = { ...BOT, id: 'bot-test-2', name: 'Section Bot', isPrimary: false, prefs: { ...BOT_PREFS, sectionId: 'section-1' } }

const SECTIONS = [{ id: 'section-1', name: 'Test section' }]
const bots: FakeBot[] = [BOT, SECTION_BOT]

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

const detail = (bot: FakeBot) => ({ ...bot, instructions: 'Answers UI tests.', abilities: [], memoryConnected: false })
const findBot = (botId: string) => {
  const bot = bots.find(candidate => candidate.id === botId)
  if (!bot) throw new Error(`fake LilBot: no bot ${botId}`)
  return bot
}

function handle(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case 'devices.current':
      return { id: params.deviceId, name: params.name, computerId: null, resolves: { via: 'none' } }
    case 'bots.list':
      return bots
    case 'bots.get':
      return detail(findBot(String(params.botId)))
    case 'bots.update': {
      const bot = findBot(String(params.botId))
      const next: FakeBot = { ...bot }
      if (params.model && typeof params.model === 'object') next.model = params.model as FakeModel
      if ('reasoningEffort' in params) {
        next.reasoningEffort = (params.reasoningEffort ?? null) as string | null
        next.effectiveReasoningEffort = next.reasoningEffort
      }
      bots[bots.findIndex(candidate => candidate.id === bot.id)] = next
      return detail(next)
    }
    case 'sections.list':
      return SECTIONS
    case 'models.list':
      return PROVIDERS
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
