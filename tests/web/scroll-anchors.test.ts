import { expect, test } from 'bun:test'
import { isScrollAnchor, loadedTranscript, updateLoaded } from '../../web/src/chat/scroll-anchors'

test('in an empty chat, the first message sent pins the list', () => {
  let loaded = loadedTranscript(0, 0, 1)
  loaded = updateLoaded(loaded, 0, 1, 1)
  expect(isScrollAnchor(loaded, 0, 'user')).toBe(true)
})

test('turns that came with the conversation do not pin; turns sent afterwards do', () => {
  let loaded = loadedTranscript(0, 4, 1)
  expect([0, 1, 2, 3].map(position => isScrollAnchor(loaded, position, 'user'))).toEqual([false, false, false, false])
  loaded = updateLoaded(loaded, 0, 5, 1)
  expect(isScrollAnchor(loaded, 4, 'user')).toBe(true)
  expect(isScrollAnchor(loaded, 5, 'assistant')).toBe(false)
})

test('live updates keep the end; a reloaded transcript moves it', () => {
  const loaded = loadedTranscript(0, 2, 1)
  // A streamed chunk or a finished tool changes later items within the same load.
  expect(updateLoaded(loaded, 0, 3, 1)).toBe(loaded)
  // Reopening after a reconnect is a new load, even when it reuses the same item objects.
  expect(updateLoaded(loaded, 0, 4, 2)).toEqual({ load: 2, end: 4 })
})

test('a message that arrived with the snapshot after the saved history is not a pin', () => {
  let loaded = loadedTranscript(0, 2, 1)
  // The snapshot brings a message sent from another device.
  loaded = updateLoaded(loaded, 0, 3, 2)
  expect(isScrollAnchor(loaded, 2, 'user')).toBe(false)
})

test('an earlier part loading above never turns an old turn into a pin', () => {
  // Four turns on screen, the last one sent live; then 100 earlier rows arrive above them.
  let loaded = loadedTranscript(0, 3, 1)
  loaded = updateLoaded(loaded, 0, 4, 1)
  loaded = updateLoaded(loaded, -100, 104, 1)
  expect(isScrollAnchor(loaded, -100, 'user')).toBe(false)
  expect(isScrollAnchor(loaded, 2, 'user')).toBe(false)
  expect(isScrollAnchor(loaded, 3, 'user')).toBe(true)
})
