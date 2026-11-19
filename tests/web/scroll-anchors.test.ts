import { expect, test } from 'bun:test'
import type { ViewItem } from '../../web/src/chat/chat-state'
import { isScrollAnchor, loadedTranscript, updateLoaded } from '../../web/src/chat/scroll-anchors'

const user = (text: string): ViewItem => ({ kind: 'user', text })
const reply = (text: string): ViewItem => ({ kind: 'assistant', text })

test('in an empty chat, the first message sent pins the list', () => {
  let loaded = loadedTranscript([], 1)
  const items = [user('hello')]
  loaded = updateLoaded(loaded, items, 1)
  expect(isScrollAnchor(loaded, 0, 'user')).toBe(true)
})

test('turns that came with the conversation do not pin; turns sent afterwards do', () => {
  const opened = [user('a'), reply('b'), user('c'), reply('d')]
  let loaded = loadedTranscript(opened, 1)
  expect(opened.map((item, index) => isScrollAnchor(loaded, index, item.kind))).toEqual([false, false, false, false])
  const later = [...opened, user('e')]
  loaded = updateLoaded(loaded, later, 1)
  expect(isScrollAnchor(loaded, 4, 'user')).toBe(true)
  expect(isScrollAnchor(loaded, 5, 'assistant')).toBe(false)
})

test('live updates keep the count; a reloaded transcript resets it', () => {
  const first = user('a')
  const loaded = loadedTranscript([first, reply('b')], 1)
  // A streamed chunk or a finished tool changes later items within the same load.
  expect(updateLoaded(loaded, [first, reply('b, more'), user('c')], 1)).toBe(loaded)
  // Reopening after a reconnect is a new load, even when it reuses the same item objects.
  const reopened = [first, reply('b'), user('c'), reply('d')]
  expect(updateLoaded(loaded, reopened, 2)).toEqual({ load: 2, count: 4 })
})

test('a message that arrived with the snapshot after the saved history is not a pin', () => {
  const first = user('a')
  const history = [first, reply('b')]
  let loaded = loadedTranscript(history, 1)
  // The snapshot reuses the first object and brings a message sent from another device.
  const snapshot = [first, history[1], user('from the phone')]
  loaded = updateLoaded(loaded, snapshot, 2)
  expect(isScrollAnchor(loaded, 2, 'user')).toBe(false)
})
