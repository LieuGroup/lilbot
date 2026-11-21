import { afterAll, expect, test } from 'bun:test'
import { serviceFixture } from '../connections/service-fixture'
import { systemFixture } from './system-fixture'

const plain = serviceFixture({ oauth: false, marker: 'PLAIN-' })
const oauth = serviceFixture({ oauth: true, marker: 'SIGNED-' })
afterAll(() => {
  plain.stop()
  oauth.stop()
})

test('lilbot_connection adds, signs in through a pasted address and removes; lilbot_status shows each state and never a token', async () => {
  const f = systemFixture()
  const added = (await f.call('b1', 'lilbot_connection', { action: 'add', name: 'plainy', address: plain.address, requestId: 'a1' })).data
  expect(added).toMatchObject({ name: 'plainy', state: 'connected', tools: 1 })
  const asking = (await f.call('b1', 'lilbot_connection', { action: 'add', name: 'oauthy', address: oauth.address, requestId: 'a2' })).data
  expect(asking.state).toBe('needs_sign_in')
  const status = async () => (await f.call('b1', 'lilbot_status', { area: 'connections' })).data
  expect((await status()).map((row: any) => [row.name, row.state, row.tools, row.addedBy])).toEqual([
    ['plainy', 'connected', 1, 'Bot One'],
    ['oauthy', 'needs_sign_in', 0, 'Bot One']
  ])

  const landed = (await fetch(asking.signInLink, { redirect: 'manual' })).headers.get('location')!
  const finished = (await f.call('b1', 'lilbot_connection', { action: 'finish', address: landed, requestId: 'a3' })).data
  expect(finished).toMatchObject({ id: asking.id, state: 'connected', tools: 1 })
  expect(f.signedIn).toEqual([{ botId: 'b1', chatId: 'b1-main', name: 'oauthy' }])
  const rows = await status()
  expect(rows.find((row: any) => row.id === asking.id).state).toBe('connected')
  const seen = JSON.stringify([rows, f.changes.recent(10)])
  for (const token of oauth.issued) expect(seen).not.toContain(token)
  // The change log names the fields, never the values (the pasted address carries a one-use code).
  expect(f.changes.recent(10).map(change => change.fields)).toContain('action, address')
  expect(JSON.stringify(f.changes.recent(10))).not.toContain(new URL(landed).searchParams.get('code')!)

  expect((await f.call('b1', 'lilbot_connection', { action: 'remove', id: added.id, requestId: 'a4' })).data).toMatchObject({ removed: true })
  expect((await status()).map((row: any) => row.name)).toEqual(['oauthy'])
})

test('add and sign_in need the conversation that called them: a call no session made is refused', async () => {
  const f = systemFixture()
  const refused = await f.call('b1', 'lilbot_connection', { action: 'add', name: 'plainy', address: plain.address, requestId: 'x1' }, false)
  expect(refused.error).toContain('could not tell which of your conversations')
  const bad = await f.call('b1', 'lilbot_connection', { action: 'add', name: 'Bad Name', address: plain.address, requestId: 'x2' })
  expect(bad.error).toContain('Invalid arguments')
  const http = await f.call('b1', 'lilbot_connection', { action: 'add', name: 'remote', address: 'http://example.com/mcp', requestId: 'x3' })
  expect(http.error).toContain('https://')
  expect((await f.call('b1', 'lilbot_status', { area: 'connections' })).data).toEqual([])
})
