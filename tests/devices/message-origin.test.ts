import { afterEach, expect, test } from 'bun:test'
import type { OpenChat } from '../../server/engines/bot-engine'
import { BrowserSession } from '../../server/http/browser-session'
import { fakeService } from '../helpers/fake-engine'
import { DEVICE_A, DEVICE_B, deviceFixture } from './device-fixture'

const closers: (() => void)[] = []
afterEach(() => {
  for (const close of closers.splice(0)) close()
})
const NOW = 1_000_000_000_000

/** A browser session over the fake engine, with devices; `sends` records what the engine's chat was asked to send. */
async function session() {
  const f = fakeService()
  const d = deviceFixture({ value: NOW })
  closers.push(d.close)
  d.add('A', 'Alpha')
  d.online('A')
  const sends: { text: string; options: Parameters<OpenChat['send']>[1] }[] = []
  const open = f.engine.openChat
  f.engine.openChat = async (...args) => {
    const chat = await open(...args)
    const send = chat.send
    chat.send = (text, options) => {
      sends.push({ text, options })
      return send(text, options)
    }
    return chat
  }
  const frames: any[] = []
  const browser = new BrowserSession(
    f.service,
    frame => frames.push(frame),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    d.computers,
    undefined,
    undefined,
    undefined,
    d.devices
  )
  let next = 1
  const call = async (method: string, params: unknown = {}) => {
    const id = next++
    await browser.handle(JSON.stringify({ id, method, params }))
    return frames.find(frame => frame.id === id)
  }
  const chat = (await call('chat.open', { botId: 'b1' })).result
  return { ...f, d, call, sends, chatId: chat.chatId as string }
}

test('a message carries its device to the engine as a line outside the text, and every browser is told with the origin', async () => {
  const s = await session()
  await s.call('devices.current', { deviceId: DEVICE_A, name: 'MacBook · Chrome' })
  await s.call('devices.linkComputer', { deviceId: DEVICE_A, computer: 'A' })
  expect((await s.call('chat.send', { chatId: s.chatId, text: 'close Capy on my computer', deviceId: DEVICE_A })).ok).toBe(true)
  const [{ text, options }] = s.sends
  expect(text).toBe('close Capy on my computer')
  expect(options?.origin?.line).toBe('[LilBot origin: sent from the device "MacBook · Chrome", which is the computer "Alpha" (id A, online).]')
  expect(options?.origin?.device).toEqual({ deviceId: DEVICE_A, name: 'MacBook · Chrome' })
  expect(options?.inputId).toMatch(/^[0-9a-f-]{36}$/)
  expect(s.log).toContain(`send:${s.chatId}:close Capy on my computer`)
  expect(s.d.sent).toEqual([
    {
      chatId: s.chatId,
      message: { messageId: options!.inputId!, text, attachments: [], images: { support: 'unknown', imageCount: 0 }, origin: { deviceId: DEVICE_A, name: 'MacBook · Chrome' } }
    }
  ])
})

test('the client’s own message id is used, a missing or unknown device is said so and stores nothing, and an engine failure leaves nothing waiting', async () => {
  const s = await session()
  const messageId = crypto.randomUUID()
  await s.call('chat.send', { chatId: s.chatId, text: 'hello', messageId })
  expect(s.sends[0].options?.inputId).toBe(messageId)
  expect(s.sends[0].options?.origin?.line).toContain('does not recognise')
  expect(s.sends[0].options?.origin?.device).toBeUndefined()
  expect(s.d.sent[0].message.origin).toBeUndefined()
  await s.call('chat.send', { chatId: s.chatId, text: 'again', deviceId: DEVICE_B })
  expect(s.sends[1].options?.origin?.device).toBeUndefined()

  await s.call('devices.current', { deviceId: DEVICE_A, name: 'Laptop' })
  const open = s.engine.openChat
  s.engine.openChat = async (...args) => {
    const chat = await open(...args)
    chat.send = async () => {
      throw new Error('engine down')
    }
    return chat
  }
  const failing = (await s.call('chat.new', { botId: 'b1' })).result
  const refused = await s.call('chat.send', { chatId: failing.chatId, text: 'lost', deviceId: DEVICE_A })
  expect(refused.ok).toBe(false)
  expect(s.d.db.query('SELECT count(*) n FROM message_origins').get()).toEqual({ n: 0 })
  expect(s.d.sent).toHaveLength(2)
})

test('without devices a send is exactly what it was: the text alone', async () => {
  const f = fakeService()
  const frames: any[] = []
  const browser = new BrowserSession(f.service, frame => frames.push(frame))
  await browser.handle(JSON.stringify({ id: 1, method: 'chat.open', params: { botId: 'b1' } }))
  const chatId = frames[0].result.chatId
  await browser.handle(JSON.stringify({ id: 2, method: 'chat.send', params: { chatId, text: 'hi', deviceId: DEVICE_A } }))
  expect(frames[1]).toEqual({ id: 2, ok: true, result: { ok: true } })
  expect(f.log).toContain(`send:${chatId}:hi`)
})
