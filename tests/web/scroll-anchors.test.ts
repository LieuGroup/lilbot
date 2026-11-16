import { expect, test } from 'bun:test'
import type { ViewItem } from '../../web/src/chat/chat-state'
import { isScrollAnchor, loadedTranscript, updateLoaded } from '../../web/src/chat/scroll-anchors'

const user = (text: string): ViewItem => ({ kind: 'user', text })
const reply = (text: string): ViewItem => ({ kind: 'assistant', text })

test('in an empty chat, the first message sent pins the list', () => {
  let loaded = loadedTranscript([])
  const items = [user('hello')]
  loaded = updateLoaded(loaded, items)
  expect(isScrollAnchor(loaded, 0, 'user')).toBe(true)
})

test('turns that came with the conversation do not pin; turns sent afterwards do', () => {
  const opened = [user('a'), reply('b'), user('c'), reply('d')]
  let loaded = loadedTranscript(opened)
  expect(opened.map((item, index) => isScrollAnchor(loaded, index, item.kind))).toEqual([false, false, false, false])
  const later = [...opened, user('e')]
  loaded = updateLoaded(loaded, later)
  expect(isScrollAnchor(loaded, 4, 'user')).toBe(true)
  expect(isScrollAnchor(loaded, 5, 'assistant')).toBe(false)
})

test('live updates keep the count; a reloaded transcript resets it', () => {
  const first = user('a')
  const opened = [first, reply('b')]
  const loaded = loadedTranscript(opened)
  // A streamed chunk or a finished tool replaces later items but keeps the first object.
  expect(updateLoaded(loaded, [first, reply('b, more'), user('c')])).toBe(loaded)
  // Reopening after a reconnect brings new objects for the same turns.
  const reopened = [user('a'), reply('b'), user('c'), reply('d')]
  expect(updateLoaded(loaded, reopened)).toEqual({ first: reopened[0], count: 4 })
})
