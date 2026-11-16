import { describe, expect, test } from 'bun:test'
import { ClientSession } from '../server/client-session'
import type { BotEngine, OpenChat } from '../server/engine/bot-engine'
import type { Bot, BotDetail } from '../shared/bot-schema'
import type { ChatEvent } from '../shared/chat-schema'
import { LeBotError } from '../shared/protocol'

const bot: Bot = { id: 'b1', name: 'Bot One', function: '', model: null, isDefault: false, skillCount: 0 }
const detail: BotDetail = { ...bot, instructions: '', toolsets: [], enabledSkillCount: 0, mcpServerCount: 0 }

/** An engine that lives in memory and records what was asked of it. */
function fakeEngine(options: { earlyEvents?: ChatEvent[] } = {}) {
  const log: string[] = []
  const emitters = new Map<string, (event: ChatEvent) => void>()
  let chats = 0
  const engine: BotEngine = {
    listBots: async () => [bot],
    getBot: async botId => {
      if (botId !== bot.id) throw new LeBotError('bot_not_found', 'That bot does not exist.')
      return detail
    },
    createBot: async input => ({ ...bot, name: input.name }),
    updateBot: async () => detail,
    listModels: async () => [],
    openChat: async (botId, chatId, onEvent): Promise<OpenChat> => {
      const id = chatId ?? `chat-${++chats}`
      emitters.set(id, onEvent)
      for (const early of options.earlyEvents ?? []) onEvent(early)
      return {
        snapshot: { chatId: id, botId, title: '', running: false, items: [] },
        send: async text => void log.push(`send:${id}:${text}`),
        stop: async () => void log.push(`stop:${id}`),
        close: () => void log.push(`close:${id}`)
      }
    }
  }
  return { engine, log, emit: (chatId: string, event: ChatEvent) => emitters.get(chatId)?.(event) }
}

function connect(options?: Parameters<typeof fakeEngine>[0]) {
  const fake = fakeEngine(options)
  const frames: any[] = []
  const session = new ClientSession(fake.engine, frame => frames.push(frame))
  let nextId = 1
  const call = async (method: string, params: unknown = {}) => {
    const id = nextId++
    await session.handle(JSON.stringify({ id, method, params }))
    return frames.find(frame => frame.id === id)
  }
  return { ...fake, session, frames, call }
}

describe('requests', () => {
  test('a valid request returns the engine result', async () => {
    const { call } = connect()
    expect(await call('bots.list')).toEqual({ id: 1, ok: true, result: [bot] })
  })

  test('unknown methods and inherited property names are refused', async () => {
    const { call } = connect()
    expect((await call('bots.destroy')).error.code).toBe('unknown_method')
    expect((await call('constructor')).error.code).toBe('unknown_method')
    expect((await call('toString')).error.code).toBe('unknown_method')
  })

  test('invalid params are refused before reaching the engine', async () => {
    const { call, log } = connect()
    expect((await call('bots.create', { name: '   ' })).error).toEqual({ code: 'invalid_params', message: 'Give the bot a name.' })
    expect((await call('chat.send', { chatId: 'x', text: '' })).error.code).toBe('invalid_params')
    expect((await call('bots.get', {})).error.code).toBe('invalid_params')
    expect(log).toEqual([])
  })

  test('engine errors meant for the user pass through; anything else is hidden', async () => {
    const { call, engine } = connect()
    expect((await call('bots.get', { botId: 'nope' })).error).toEqual({ code: 'bot_not_found', message: 'That bot does not exist.' })
    engine.listModels = async () => {
      throw new Error('secret internal detail')
    }
    const hidden = (await call('models.list')).error
    expect(hidden.code).toBe('internal')
    expect(hidden.message).not.toContain('secret')
  })

  test('a frame that is not a request is dropped without a reply', async () => {
    const { session, frames } = connect()
    await session.handle('not json')
    await session.handle(JSON.stringify({ method: 'bots.list' }))
    expect(frames).toEqual([])
  })
})

describe('chats', () => {
  test('send and stop reach the open chat; a chat that is not open is refused', async () => {
    const { call, log } = connect()
    const { chatId } = (await call('chat.open', { botId: 'b1', chatId: null })).result
    await call('chat.send', { chatId, text: 'hello' })
    await call('chat.stop', { chatId })
    expect(log).toEqual([`send:${chatId}:hello`, `stop:${chatId}`])
    expect((await call('chat.send', { chatId: 'other', text: 'hi' })).error.code).toBe('chat_not_open')
  })

  test('events that arrive before the open response are delivered after it, in order', async () => {
    const early: ChatEvent[] = [{ type: 'turn.started' }, { type: 'text.delta', text: 'a' }]
    const { call, frames, emit } = connect({ earlyEvents: early })
    const response = await call('chat.open', { botId: 'b1', chatId: null })
    emit(response.result.chatId, { type: 'text.delta', text: 'b' })
    expect(frames.map(frame => (frame.event ? frame.data : 'response'))).toEqual(['response', ...early, { type: 'text.delta', text: 'b' }])
  })

  test('a closed chat is forgotten, and closing the connection closes every chat', async () => {
    const { call, emit, log, session } = connect()
    const first = (await call('chat.open', { botId: 'b1', chatId: null })).result.chatId
    const second = (await call('chat.open', { botId: 'b1', chatId: null })).result.chatId
    emit(first, { type: 'closed', message: 'lost' })
    expect((await call('chat.send', { chatId: first, text: 'hi' })).error.code).toBe('chat_not_open')
    session.close()
    expect(log).toContain(`close:${second}`)
  })

  test('opening the same chat again closes the earlier handle', async () => {
    const { call, log } = connect()
    const { chatId } = (await call('chat.open', { botId: 'b1', chatId: null })).result
    await call('chat.open', { botId: 'b1', chatId })
    expect(log).toEqual([`close:${chatId}`])
  })

  test('the number of open chats per connection is limited', async () => {
    const { call } = connect()
    for (let i = 0; i < 8; i++) expect((await call('chat.open', { botId: 'b1', chatId: null })).ok).toBe(true)
    expect((await call('chat.open', { botId: 'b1', chatId: null })).error.code).toBe('too_many_chats')
  })
})
