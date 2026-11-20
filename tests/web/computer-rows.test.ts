import { expect, test } from 'bun:test'
import type { Computer } from '../../shared/computer-schema'
import { agoOf, CONFLICT_TEXT, computerRows, countdown } from '../../web/src/computers/computer-rows'

const NOW = 1_000_000_000_000
const machine = (id: string, extra: Partial<Computer> = {}): Computer => ({
  id,
  name: id,
  os: 'darwin',
  home: '/Users/x',
  capabilities: [],
  online: false,
  lastSeen: null,
  keyConflict: false,
  main: false,
  ...extra
})

test('the leader comes first and says where LilBot runs; the others follow by name', () => {
  const rows = computerRows([machine('Mac mini'), machine('leader', { os: 'linux', online: true, lastSeen: NOW }), machine('Air', { online: true })], NOW)
  expect(rows.map(row => row.name)).toEqual(['leader', 'Air', 'Mac mini'])
  expect(rows[0]).toMatchObject({ isLeader: true, status: 'online', line: 'Linux · where LilBot runs · online' })
  expect(rows[1]?.line).toBe('macOS · online')
})

test('an offline machine says when it was last seen, or that it never connected', () => {
  const [seen, never] = computerRows([machine('a', { lastSeen: NOW - 2 * 3_600_000 }), machine('b')], NOW)
  expect(seen?.line).toBe('macOS · offline · last seen 2 hours ago')
  expect(never?.line).toBe('macOS · offline · never connected')
})

test('a key conflict outranks online and replaces the line with the explanation', () => {
  const [row] = computerRows([machine('imac', { online: true, keyConflict: true })], NOW)
  expect(row).toMatchObject({ status: 'conflict', line: CONFLICT_TEXT })
})

test('relative times and the install-code countdown', () => {
  expect([agoOf(30_000), agoOf(60_000), agoOf(3_600_000), agoOf(86_400_000 * 3)]).toEqual(['just now', '1 minute ago', '1 hour ago', '3 days ago'])
  expect([countdown(581_000), countdown(600_000), countdown(-5)]).toEqual(['9:41', '10:00', '0:00'])
})

test('the main computer is marked, and the row this device runs on says so', () => {
  const rows = computerRows([machine('leader', { os: 'linux', online: true, main: true }), machine('Air', { online: true }), machine('imac', { keyConflict: true })], NOW, 'Air')
  expect(rows.map(row => [row.name, row.main])).toEqual([
    ['leader', true],
    ['Air', false],
    ['imac', false]
  ])
  expect(rows[1]?.line).toBe('macOS · online · this device runs on it')
  expect(rows[0]?.line).toBe('Linux · where LilBot runs · online')
  expect(computerRows([machine('imac', { keyConflict: true })], NOW, 'imac')[0]?.line).toBe(CONFLICT_TEXT)
})
