import { expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { delegationFixture } from './delegation-fixture'

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

test('one call hands one task to each bot as one batch; a file is copied, never shared, and listed with its sender', async () => {
  const f = delegationFixture()
  write(f.path('a', 'notes/report.txt'), 'hello')
  const result = await f.delegation.delegate('a', {
    requestId: 'r1',
    tasks: [
      { to: 'b', task: 'Summarise it', files: ['notes/report.txt'] },
      { to: 'C', task: 'Check the build' }
    ]
  })
  const [x, y] = result.exchanges
  expect([x.to, y.to]).toEqual(['B', 'C'])
  expect(x.batchId).toBe(y.batchId)
  expect(x.status).toBe('waiting')
  const thread = await f.threads.open('b', x.exchangeId)
  const [file] = thread.messages[0].files!
  expect(file).toMatchObject({ name: 'report.txt', size: 5, fromId: 'a' })
  expect(file.path).toMatch(new RegExp(`^exchanges/${x.exchangeId}/[0-9a-f]{8}-report\\.txt$`))
  expect(readFileSync(f.path('b', file.path!), 'utf8')).toBe('hello')
  // A retry with the same request id hands nothing out again and copies nothing again.
  const again = await f.delegation.delegate('a', {
    requestId: 'r1',
    tasks: [
      { to: 'b', task: 'Summarise it', files: ['notes/report.txt'] },
      { to: 'C', task: 'Check the build' }
    ]
  })
  expect(again.exchanges.map(e => e.exchangeId)).toEqual([x.exchangeId, y.exchangeId])
  expect(readdirSync(f.path('b', `exchanges/${x.exchangeId}`))).toHaveLength(1)
  expect(f.store.batch(x.batchId!)).toEqual([x.exchangeId, y.exchangeId])
})

test('links, paths outside the folder, missing files and too many files are refused before anything is handed out', async () => {
  const f = delegationFixture()
  write(f.path('a', 'real.txt'), 'x')
  write(f.path('b', 'secret.txt'), 'b only')
  symlinkSync(f.path('a', 'real.txt'), f.path('a', 'link.txt'))
  mkdirSync(f.path('a', 'dir'))
  symlinkSync(f.path('b', ''), f.path('a', 'dir/other'))
  const hand = (files: string[], requestId = crypto.randomUUID()) => f.delegation.delegate('a', { requestId, tasks: [{ to: 'b', task: 'Look', files }] })
  await expect(hand(['link.txt'])).rejects.toThrow('link')
  await expect(hand(['dir/other/secret.txt'])).rejects.toThrow('link')
  await expect(hand(['../b/secret.txt'])).rejects.toThrow('inside your folder')
  await expect(hand([f.path('b', 'secret.txt')])).rejects.toThrow('inside your folder')
  await expect(hand(['nothing.txt'])).rejects.toThrow('does not exist')
  await expect(hand(['dir'])).rejects.toThrow('regular file')
  await expect(hand(Array(11).fill('real.txt'))).rejects.toThrow()
  expect(f.store.list('a')).toHaveLength(0)
  // Absolute paths inside the bot's own folder are fine.
  expect((await hand([f.path('a', 'real.txt')])).exchanges).toHaveLength(1)
})

test('one task per bot, never yourself, and a bounded number of delegations under way', async () => {
  const f = delegationFixture()
  await expect(
    f.delegation.delegate('a', {
      requestId: 'dup',
      tasks: [
        { to: 'b', task: 'one' },
        { to: 'B', task: 'two' }
      ]
    })
  ).rejects.toThrow('One task per bot')
  await expect(f.delegation.delegate('a', { requestId: 'self', tasks: [{ to: 'a', task: 'me' }] })).rejects.toThrow('yourself')
  for (let i = 0; i < 8; i++) await f.threads.ask('a', { to: 'b', requestId: `ask-${i}`, chatId: 'a-main', text: 'work' })
  await expect(f.delegation.delegate('a', { requestId: 'over', tasks: [{ to: 'c', task: 'more' }] })).rejects.toThrow('At most 8')
})

test('the receiver attaches files to its answer; they reach the delegating bot with it', async () => {
  const f = delegationFixture()
  const { exchanges } = await f.delegation.delegate('a', { requestId: 'r', tasks: [{ to: 'b', task: 'Make a chart' }] })
  const id = exchanges[0].exchangeId
  await expect(f.delegation.attach('b', { exchangeId: id, files: ['chart.png'] })).rejects.toThrow('while you work')
  await f.settle()
  expect(f.runs[0].prompt).toContain(`exchange ${id}`)
  write(f.path('b', 'chart.png'), 'png')
  await expect(f.delegation.attach('c', { exchangeId: id, files: ['chart.png'] })).rejects.toThrow('while you work')
  await f.delegation.attach('b', { exchangeId: id, files: ['chart.png'] })
  f.runs[0].finish('Here is the chart')
  await f.settle()
  await f.settle()
  const answer = f.runs[1]
  expect(answer.botId).toBe('a')
  const path = /exchanges\/\S+-chart\.png/.exec(answer.prompt)![0]
  expect(readFileSync(f.path('a', path), 'utf8')).toBe('png')
  const reply = (await f.threads.open('a', id)).messages[1]
  expect(reply.files).toEqual([{ name: 'chart.png', size: 3, fromId: 'b', path }])
})
