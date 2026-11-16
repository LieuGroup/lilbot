import { describe, expect, test } from 'bun:test'
import { BrowserSession } from '../../server/http/browser-session'
import type { ChatEvent } from '../../shared/chat-schema'
import { fakeService } from '../helpers/fake-engine'

function connect(options?: Parameters<typeof fakeService>[0]) {
  const fake = fakeService(options)
  const frames: any[] = []
  const session = new BrowserSession(fake.service, frame => frames.push(frame))
  let nextId = 1
  const call = async (method: string, params: unknown = {}) => {
    const id = nextId++
    await session.handle(JSON.stringify({ id, method, params }))
    return frames.find(frame => frame.id === id)
  }
  return { ...fake, session, frames, call }
}

describe('requests', () => {
  test('a valid request returns the result', async () => {
    const { call } = connect()
    const response = await call('bots.list')
    expect(response.ok).toBe(true)
    expect(response.result[0]).toMatchObject({ id: 'b1', name: 'Bot One', prefs: { pinned: false } })
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
    expect((await call('bots.setPrefs', { botId: 'b1', avatar: { shape: 'blob', color: 'blue' } })).error.code).toBe('invalid_params')
    expect(log).toEqual([])
  })

  test('errors meant for the user pass through; anything else is hidden', async () => {
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

test('primary requests validate params, reject missing bots and notify clients', async () => {
  const { call, changes, prefs } = connect()
  expect((await call('bots.setPrimary', { botId: '' })).error.code).toBe('invalid_params')
  expect((await call('bots.setPrimary', { botId: 'missing' })).error.code).toBe('bot_not_found')
  expect((await call('bots.setPrimary', { botId: 'b1' })).result).toEqual({ ok: true })
  expect(prefs.primaryBot()).toBe('b1')
  expect(changes()).toBe(1)
  expect((await call('bots.list')).result[0].isPrimary).toBe(true)
})

describe('chats', () => {
  test('send and stop reach the open chat; a chat that is not open is refused', async () => {
    const { call, log } = connect()
    const { chatId } = (await call('chat.open', { botId: 'b1' })).result
    await call('chat.send', { chatId, text: 'hello' })
    await call('chat.stop', { chatId })
    expect(log.slice(1)).toEqual([`send:${chatId}:hello`, `stop:${chatId}`])
    expect((await call('chat.send', { chatId: 'other', text: 'hi' })).error.code).toBe('chat_not_open')
  })

  test('events that arrive before the open response are delivered after it, in order', async () => {
    const early: ChatEvent[] = [{ type: 'turn.started' }, { type: 'text.delta', text: 'a' }]
    const { call, frames, emit } = connect({ earlyEvents: early })
    const response = await call('chat.open', { botId: 'b1' })
    emit(response.result.chatId, { type: 'text.delta', text: 'b' })
    expect(frames.map(frame => (frame.event ? frame.data : 'response'))).toEqual(['response', ...early, { type: 'text.delta', text: 'b' }])
  })

  test('a closed chat is forgotten, and closing the connection closes every chat', async () => {
    const { call, emit, log, session } = connect()
    const first = (await call('chat.open', { botId: 'b1' })).result.chatId
    const second = (await call('chat.new', { botId: 'b1' })).result.chatId
    emit(first, { type: 'closed', message: 'lost' })
    expect((await call('chat.send', { chatId: first, text: 'hi' })).error.code).toBe('chat_not_open')
    session.close()
    expect(log).toContain(`close:${second}`)
  })

  test('opening the same chat again closes the earlier handle', async () => {
    const { call, log } = connect()
    const { chatId } = (await call('chat.open', { botId: 'b1' })).result
    await call('chat.open', { botId: 'b1' })
    expect(log.filter(entry => entry.startsWith('close:'))).toEqual([`close:${chatId}`])
  })

  test('the number of open chats per connection is limited', async () => {
    const { call } = connect()
    for (let i = 0; i < 8; i++) expect((await call('chat.new', { botId: 'b1' })).ok).toBe(true)
    expect((await call('chat.new', { botId: 'b1' })).error.code).toBe('too_many_chats')
  })
})
