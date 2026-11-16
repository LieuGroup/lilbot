import { expect, test } from 'bun:test'
import { applyActivityReplay, replayNeedsReset, replayPosition } from '../../server/engines/activity-replay'

const batch = (updates: Parameters<typeof applyActivityReplay>[1]['updates'], sequence = 3, epoch = 'one') => ({ epoch, sequence, updates, running: true, waiting: false })
test('incremental replay keeps a tool through empty polls and text, then clears it', () => {
  const first = applyActivityReplay(undefined, batch([{ sequence: 1, status: 'working', tool: 'terminal' }], 1)).state
  expect(replayPosition(first)).toEqual({ last_sequence: 1, replay_epoch: 'one' })
  const empty = applyActivityReplay(first, batch([], 1)).state
  expect(empty).toEqual(first)
  const text = applyActivityReplay(empty, batch([{ sequence: 2, spoke: true }], 2))
  expect(text.state.tool).toBe('terminal')
  expect(text.spoke).toBe(true)
  const done = applyActivityReplay(
    text.state,
    batch(
      [
        { sequence: 3, clearTool: true },
        { sequence: 4, status: 'finished', clearTool: true }
      ],
      4
    )
  )
  expect(done.state.tool).toBeUndefined()
  expect(done.state.status).toBe('finished')
})
test('restart reads a baseline but does not mark already consumed replies as new', () => {
  expect(replayPosition()).toEqual({ last_sequence: 0 })
  const result = applyActivityReplay(
    undefined,
    batch(
      [
        { sequence: 1, tool: 'terminal', status: 'working' },
        { sequence: 2, spoke: true }
      ],
      2
    ),
    'one:2'
  )
  expect(result.state.tool).toBe('terminal')
  expect(result.spoke).toBe(false)
})
test('epoch changes and truncated batches require a fresh baseline', () => {
  const old = applyActivityReplay(undefined, batch([], 50)).state
  expect(replayNeedsReset(old, 'one', false)).toBe(false)
  expect(replayNeedsReset(old, 'two', false)).toBe(true)
  expect(replayNeedsReset(old, 'one', true)).toBe(true)
  expect(replayNeedsReset(undefined, 'one', true)).toBe(false)
  const reset = applyActivityReplay(undefined, batch([{ sequence: 1, spoke: true, status: 'finished' }], 1, 'two'), 'one:50')
  expect(reset.spoke).toBe(true)
  expect(reset.state.sequence).toBe(1)
})
test('waiting survives empty polls and clears when open requests disappear', () => {
  const waiting = applyActivityReplay(undefined, { ...batch([]), waiting: true }).state
  expect(waiting.status).toBe('waiting')
  expect(applyActivityReplay(waiting, batch([])).state.status).toBe('working')
})
