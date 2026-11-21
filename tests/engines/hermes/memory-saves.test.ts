import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chatEventFrom } from '../../../server/engines/hermes/hermes-chat-mapping'
import { historyRows } from '../../../server/engines/hermes/hermes-history-mapping'
import { saveFailed } from '../../../server/engines/hermes/hermes-memory-saves'

const home = mkdtempSync(join(tmpdir(), 'lilbot-saves-'))
const previous = process.env.HERMES_HOME
const line = (session: string, at: number, saved: boolean) => `${JSON.stringify({ session, at, saved })}\n`

beforeAll(() => {
  process.env.HERMES_HOME = home
  mkdirSync(join(home, 'profiles', 'dev-bot'), { recursive: true })
  writeFileSync(
    join(home, 'profiles', 'dev-bot', 'lilbot-memory-saves.jsonl'),
    line('main', 100, false) + 'not json\n' + line('main', 200, true) + line('main', 300, false) + line('other', 50, true)
  )
})
afterAll(() => {
  process.env.HERMES_HOME = previous
  rmSync(home, { recursive: true, force: true })
})

test("a turn failed for want of the save only while its session's latest save before it had failed", () => {
  expect([50, 150, 250, 350].map(seconds => saveFailed('dev-bot', ['main'], seconds * 1000))).toEqual([false, true, false, true])
  expect(saveFailed('dev-bot', ['other'], 400_000)).toBe(false)
  expect(saveFailed('dev-bot', ['runtime-id', 'main'], 400_000)).toBe(true)
  expect(saveFailed('dev-none', ['main'])).toBe(false)
})

test("a failed turn's live event and its stored closing row both become LilBot's line, nothing of Hermes' text", () => {
  const failed = { type: 'message.complete', payload: { status: 'error', text: '⚠️ Something went wrong. Use /retry.' } }
  expect(chatEventFrom(failed, () => saveFailed('dev-bot', ['main']))).toEqual({ type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save' })
  expect(chatEventFrom(failed, () => false)).toEqual({ type: 'turn.finished', status: 'failed', text: '⚠️ Something went wrong. Use /retry.' })
  const closing = (row_id: number, timestamp: number) => ({
    row_kind: 'message',
    row_id,
    role: 'assistant',
    text: 'This turn did not complete.',
    display_kind: 'failed_turn',
    timestamp
  })
  expect(historyRows('dev-bot', 'main', [closing(1, 150), closing(2, 250), { ...closing(3, 350), display_kind: null }]).map(row => row.item)).toEqual([
    { kind: 'error', text: '', reason: 'memory_save' },
    { kind: 'assistant', text: 'This turn did not complete.' },
    { kind: 'assistant', text: 'This turn did not complete.' }
  ])
})
