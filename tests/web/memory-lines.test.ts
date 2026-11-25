import { expect, test } from 'bun:test'
import { matchLine, notConnectedLine, originLine, removedLine, removedLink, rowNote, seenLine } from '../../shared/client/memory/memory-lines'
import type { MemoryFact } from '../../shared/memory-schema'

const NOW = Date.UTC(2026, 10, 25, 12)
const fact = (over: Partial<MemoryFact> = {}): MemoryFact => ({
  id: 'f1',
  botId: 'chief',
  kind: 'profile',
  scope: 'shared',
  text: 'Release notes as a table.',
  author: 'bot',
  via: 'chat',
  learnedAt: Date.UTC(2026, 10, 20, 12),
  paused: false,
  expiresAt: null,
  forgottenAt: null,
  forgottenBy: null,
  ...over
})

test('a row shows only text unless bots cannot see the fact right now', () => {
  expect(rowNote(fact(), NOW)).toBe('')
  expect(rowNote(fact({ paused: true }), NOW)).toBe('Paused')
  expect(rowNote(fact({ expiresAt: NOW - 1 }), NOW)).toBe('Ended')
  expect(rowNote(fact({ expiresAt: NOW + 1 }), NOW)).toBe('')
})

test('an opened fact says how it got here and who sees it', () => {
  expect(originLine(fact(), 'Chief')).toMatch(/^Learned by Chief in a chat · /)
  expect(originLine(fact({ author: 'user', via: 'app' }), 'Chief')).toMatch(/^Added by you · /)
  expect(originLine(fact({ via: 'review' }), 'Chief')).toMatch(/^Found by Chief when reviewing a chat/)
  expect(originLine(fact({ via: 'import' }), 'Chief')).toMatch(/^Brought over from Chief’s earlier notes/)
  expect(seenLine(fact(), 'Chief', NOW)).toBe('Every bot sees this')
  expect(seenLine(fact({ scope: 'bot' }), 'Atlas', NOW)).toBe('Only Atlas sees this')
  expect(seenLine(fact({ paused: true }), 'Chief', NOW)).toBe('Paused: no bot sees it for now')
  expect(seenLine(fact({ scope: 'bot', paused: true }), 'Atlas', NOW)).toBe('Paused: Atlas does not see it for now')
  expect(seenLine(fact({ expiresAt: NOW + 86_400_000 }), 'Chief', NOW)).toMatch(/^Every bot sees this until /)
  expect(seenLine(fact({ expiresAt: NOW - 1 }), 'Chief', NOW)).toMatch(/^Ended .*: bots no longer see it$/)
})

test('a removed fact names who removed it', () => {
  expect(removedLine(fact({ forgottenAt: NOW, forgottenBy: 'user' }), 'Atlas')).toMatch(/^Removed by you · /)
  expect(removedLine(fact({ forgottenAt: NOW, forgottenBy: 'bot' }), 'Atlas')).toMatch(/^Removed by Atlas · /)
})

test('counts and lists read naturally', () => {
  expect(removedLink(1)).toBe('1 removed fact')
  expect(removedLink(6)).toBe('6 removed facts')
  expect(matchLine(0, false)).toBe('No fact matches')
  expect(matchLine(1, false)).toBe('1 fact matches')
  expect(matchLine(50, true)).toBe('50+ facts match')
  expect(notConnectedLine(['Atlas'])).toBe('Atlas still uses its engine’s own notes, so it does not read this memory.')
  expect(notConnectedLine(['Atlas', 'Pulse', 'Relay'])).toBe('Atlas, Pulse and Relay still use their engine’s own notes, so they do not read this memory.')
})
