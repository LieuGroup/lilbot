import { expect, test } from 'bun:test'
import type { Webhook, WebhookRun } from '../../shared/webhook-schema'
import { ago, createdText, deleteText, runTitle, webhookLine } from '../../web/src/webhooks/webhook-lines'

const NOW = new Date(2026, 10, 21, 16, 0).getTime()
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()

const run = (extra: Partial<WebhookRun> = {}): WebhookRun => ({
  id: 'r1',
  webhookId: 'w',
  botId: 'b',
  createdAt: at(21, 14, 12),
  events: 3,
  startedAt: at(21, 14, 12),
  finishedAt: at(21, 14, 13),
  chatId: 'c',
  status: 'completed',
  result: '',
  message: null,
  ...extra
})

const webhook = (extra: Partial<Webhook> = {}): Webhook => ({
  id: 'w',
  botId: 'b',
  description: 'Triage new LilBot issues',
  source: 'GitHub',
  createdBy: 'oscar',
  signing: 'github',
  paused: false,
  capabilities: [],
  createdAt: at(20, 9),
  lastEventAt: at(21, 14),
  runs: [],
  ...extra
})

test('the time since an event reads in minutes, then hours, then the day', () => {
  expect(ago(NOW - 20_000, NOW)).toBe('just now')
  expect(ago(NOW - 5 * 60_000, NOW)).toBe('5 min ago')
  expect(ago(NOW - 61 * 60_000, NOW)).toBe('1 hour ago')
  expect(ago(at(21, 14), NOW)).toBe('2 hours ago')
  expect(ago(at(19, 9), NOW)).toBe('on Thu 19 Nov')
})

test('a row says its source and last event, or that it is paused, running or failed', () => {
  expect(webhookLine(webhook(), NOW)).toEqual({ text: 'GitHub · last event 2 hours ago', tone: 'plain' })
  expect(webhookLine(webhook({ paused: true, lastEventAt: null }), NOW)).toEqual({ text: 'Paused · GitHub · no events yet', tone: 'paused' })
  expect(webhookLine(webhook({ paused: true, runs: [run({ status: 'pending' })] }), NOW)).toEqual({ text: 'Running now · GitHub', tone: 'running' })
  expect(webhookLine(webhook({ runs: [run({ status: 'failed' }), run()] }), NOW)).toEqual({ text: 'Last run failed · GitHub · last event 2 hours ago', tone: 'failed' })
})

test('a run is titled by when its events came and how many', () => {
  expect(runTitle(run(), NOW)).toBe('Today 14:12 · 3 events')
  expect(runTitle(run({ events: 1, createdAt: at(20, 9, 30) }), NOW)).toBe('Yesterday 09:30 · 1 event')
})

test('who made it, and the delete question names the sender', () => {
  expect(createdText(webhook(), 'FillLight Bot')).toBe('You asked for it')
  expect(createdText(webhook({ createdBy: 'bot' }), 'FillLight Bot')).toBe('FillLight Bot made it')
  expect(deleteText(webhook())).toBe('Its address stops working at once, and its past runs are removed. GitHub will keep calling it until the bot or you remove it there.')
})
