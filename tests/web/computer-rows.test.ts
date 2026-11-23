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
  expect(rows[0]).toMatchObject({ isLeader: true, status: 'online', line: 'Linux · where LilBot runs · online', workerText: null, workerReady: false })
  expect(rows[1]).toMatchObject({ line: 'macOS · online', workerText: 'No coding engine', workerReady: false })
})

test('an offline machine says when it was last seen, or that it never connected', () => {
  const [seen, never] = computerRows([machine('a', { lastSeen: NOW - 2 * 3_600_000 }), machine('b')], NOW)
  expect(seen).toMatchObject({ line: 'macOS · offline · last seen 2 hours ago', workerText: 'No coding engine', workerReady: false })
  expect(never).toMatchObject({ line: 'macOS · offline · never connected', workerText: null, workerReady: false })
})

test('rows show detected coding engines without assuming only one engine exists', () => {
  const rows = computerRows(
    [
      machine('Mac mini', { online: true, capabilities: ['exec', 'worker'], workerAgents: [{ driver: 'claude-code', version: '2.1.327' }] }),
      machine('Multi', {
        online: true,
        capabilities: ['exec', 'worker'],
        workerAgents: [
          { driver: 'claude-code', version: '2.1' },
          { driver: 'codex-cli' as never, version: '0.9' }
        ]
      }),
      machine('Sleeping', { online: false, lastSeen: NOW - 60_000, capabilities: ['exec', 'worker'], workerAgents: [{ driver: 'claude-code', version: '2.1' }] })
    ],
    NOW
  )
  expect(rows.find(r => r.name === 'Mac mini')).toMatchObject({ workerText: 'Coding workers (Claude Code)', workerReady: true })
  expect(rows.find(r => r.name === 'Multi')).toMatchObject({ workerText: 'Coding workers (Claude Code, Codex Cli)', workerReady: true })
  expect(rows.find(r => r.name === 'Sleeping')).toMatchObject({ workerText: 'Coding workers (Claude Code)', workerReady: false })
})

test('a key conflict outranks online and replaces the line with the explanation', () => {
  const [row] = computerRows([machine('imac', { online: true, keyConflict: true, capabilities: ['worker'] })], NOW)
  expect(row).toMatchObject({ status: 'conflict', line: CONFLICT_TEXT, workerText: null, workerReady: false, thisDevice: false })
})

test('relative times and the install-code countdown', () => {
  expect([agoOf(30_000), agoOf(60_000), agoOf(3_600_000), agoOf(86_400_000 * 3)]).toEqual(['just now', '1 minute ago', '1 hour ago', '3 days ago'])
  expect([countdown(581_000), countdown(600_000), countdown(-5)]).toEqual(['9:41', '10:00', '0:00'])
})

test('the main computer is marked, and the row this device runs on says so', () => {
  const rows = computerRows([machine('leader', { os: 'linux', online: true, main: true }), machine('Air', { online: true }), machine('imac', { keyConflict: true })], NOW, 'Air')
  expect(rows.map(row => [row.name, row.main, row.thisDevice])).toEqual([
    ['leader', true, false],
    ['Air', false, true],
    ['imac', false, false]
  ])
  expect(computerRows([machine('imac', { keyConflict: true })], NOW, 'imac')[0]).toMatchObject({ line: CONFLICT_TEXT, thisDevice: false })
})
