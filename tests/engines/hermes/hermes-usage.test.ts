import { describe, expect, test } from 'bun:test'
import type { ContextReport } from '../../../server/engines/bot-engine'
import { openChat } from '../../../server/engines/hermes/hermes-chat'
import { chatEventFrom } from '../../../server/engines/hermes/hermes-chat-mapping'
import type { HermesEvent, HermesSocket } from '../../../server/engines/hermes/hermes-socket'
import type { SpareSockets } from '../../../server/engines/hermes/hermes-spare-sockets'
import { contextFromInfo, rowIdFromComplete, TurnUsageTracker } from '../../../server/engines/hermes/hermes-usage'
import type { ChatEvent } from '../../../shared/chat-schema'

describe('TurnUsageTracker', () => {
  test('computes per-turn token and cache deltas from cumulative counters across turns', () => {
    const tracker = new TurnUsageTracker(true)
    tracker.onTurnStart()
    const live = tracker.onSessionUsage({
      input_tokens: 120,
      cache_read_tokens: 0,
      cache_write_tokens: 4500,
      output_tokens: 80,
      context_tokens: 4620,
      context_length: 200_000,
      compression_count: 0
    })
    expect(live).toEqual({ used: 4620, window: 200_000 })
    tracker.onSessionUsage({
      input_tokens: 260,
      cache_read_tokens: 4600,
      cache_write_tokens: 4700,
      output_tokens: 210,
      context_tokens: 4950,
      context_length: 200_000,
      compression_count: 0
    })
    const turn1 = tracker.onComplete({
      status: 'complete',
      text: 'first',
      usage: { input: 260, output: 210, calls: 2, context_used: 4950, context_max: 200_000, compressions: 0 },
      persisted_turn: { final_assistant_row_id: 14 }
    })
    expect(turn1.usage).toEqual({ inputTokens: 260, cacheReadTokens: 4600, cacheWriteTokens: 4700, outputTokens: 210, contextTokens: 4950, contextWindow: 200_000 })
    expect(turn1.compacted).toBeUndefined()
    expect(rowIdFromComplete('dev-1', { persisted_turn: { final_assistant_row_id: 14 } })).toBe('hermes:dev-1:14')

    tracker.onTurnStart()
    tracker.onSessionUsage({
      input_tokens: 310,
      cache_read_tokens: 9500,
      cache_write_tokens: 4850,
      output_tokens: 300,
      context_tokens: 5200,
      context_length: 200_000,
      compression_count: 0
    })
    const turn2 = tracker.onComplete({ status: 'complete', text: 'second', usage: { input: 310, output: 300, calls: 3, context_used: 5200, context_max: 200_000 } })
    expect(turn2.usage).toEqual({ inputTokens: 50, cacheReadTokens: 4900, cacheWriteTokens: 150, outputTokens: 90, contextTokens: 5200, contextWindow: 200_000 })
  })

  test('detects compaction before/after context sizes and handles counter resets after agent eviction', () => {
    const tracker = new TurnUsageTracker()
    tracker.seedStats({
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 80_000,
      cache_write_tokens: 10_000,
      context_tokens: 92_000,
      context_length: 200_000,
      compression_count: 0
    })
    tracker.onTurnStart()
    tracker.onSessionUsage({
      input_tokens: 400,
      output_tokens: 120,
      cache_read_tokens: 0,
      cache_write_tokens: 18_000,
      context_tokens: 18_400,
      context_length: 200_000,
      compression_count: 1
    })
    const done = tracker.onComplete({ status: 'complete', text: 'ok', usage: { input: 400, output: 120, calls: 1, context_used: 18_400, context_max: 200_000, compressions: 1 } })
    expect(done.usage).toEqual({ inputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 18_000, outputTokens: 120, contextTokens: 18_400, contextWindow: 200_000 })
    expect(done.compacted).toEqual({ beforeTokens: 92_000, afterTokens: 18_400 })
  })

  test('leaves usage empty when unreported or before baseline is known, and extracts contextFromInfo safely', () => {
    expect(new TurnUsageTracker(true).onComplete({ status: 'complete', text: 'hi' })).toEqual({})

    const unseeded = new TurnUsageTracker(false)
    unseeded.onSessionUsage({ input_tokens: 5000, cache_read_tokens: 40_000, output_tokens: 900, context_tokens: 12_000, context_length: 200_000 })
    expect(unseeded.onComplete({ status: 'complete', text: 'a', usage: { context_used: 12_000, context_max: 200_000 } }).usage).toEqual({
      contextTokens: 12_000,
      contextWindow: 200_000
    })
    unseeded.onSessionUsage({ input_tokens: 5080, cache_read_tokens: 52_000, output_tokens: 950, context_tokens: 12_200, context_length: 200_000 })
    expect(unseeded.onComplete({ status: 'complete', text: 'b', usage: { context_used: 12_200, context_max: 200_000 } }).usage).toEqual({
      inputTokens: 80,
      cacheReadTokens: 12_000,
      outputTokens: 50,
      contextTokens: 12_200,
      contextWindow: 200_000
    })

    expect(contextFromInfo({ context_length: 200_000 }, true)).toEqual({ used: 0, window: 200_000 })
    expect(contextFromInfo({ context_length: 200_000 }, false)).toEqual({ window: 200_000 })
    expect(contextFromInfo({ context_length: 200_000, usage: { context_used: 14_200, context_max: 128_000 } }, false)).toEqual({ used: 14_200, window: 128_000 })
    expect(contextFromInfo({}, false)).toBeUndefined()
  })
})

test('openChat seeds baseline from session.stats on active resume and emits per-turn usage and context', async () => {
  const calls: string[] = []
  let push: (event: HermesEvent) => void = () => {}
  const socket = {
    async request(method: string) {
      calls.push(method)
      if (method === 'config.get') return { value: 'off' }
      if (method === 'session.resume')
        return { session_id: 's1', stored_session_id: 's1', display_messages: [], info: { context_length: 200_000, usage: { calls: 2, context_used: 8000, context_max: 200_000 } } }
      if (method === 'session.stats')
        return { input_tokens: 500, output_tokens: 300, cache_read_tokens: 7000, cache_write_tokens: 1000, context_tokens: 8000, context_length: 200_000, compression_count: 0 }
      return {}
    },
    rebind(onEvent: (event: HermesEvent) => void) {
      push = onEvent
      return socket
    },
    close() {}
  }
  const spares = { take: async () => socket, refill() {} } as unknown as SpareSockets
  const events: ChatEvent[] = []
  const contexts: ContextReport[] = []
  const chat = await openChat(
    spares,
    'dev-bot',
    's1',
    { workspace: '/w', onContext: c => contexts.push(c) },
    event => events.push(event),
    (async () => socket as unknown as HermesSocket) as typeof HermesSocket.connect
  )
  expect(calls).toEqual(['config.get', 'session.resume', 'session.stats'])
  expect(chat.snapshot.context).toEqual({ used: 8000, window: 200_000 })
  expect(contexts).toEqual([{ used: 8000, window: 200_000 }])

  push({ type: 'message.start', payload: {} })
  push({
    type: 'session.usage',
    payload: { input_tokens: 560, output_tokens: 390, cache_read_tokens: 15_000, cache_write_tokens: 1200, context_tokens: 8500, context_length: 200_000, compression_count: 0 }
  })
  push({
    type: 'message.complete',
    payload: {
      status: 'complete',
      text: 'answer',
      usage: { input: 560, output: 390, calls: 3, context_used: 8500, context_max: 200_000 },
      persisted_turn: { final_assistant_row_id: 21 }
    }
  })

  expect(events.find(e => e.type === 'turn.finished')).toEqual({
    type: 'turn.finished',
    status: 'completed',
    text: 'answer',
    contextTokens: 8500,
    rowId: 'hermes:dev-bot:21',
    usage: { inputTokens: 60, cacheReadTokens: 8000, cacheWriteTokens: 200, outputTokens: 90, contextTokens: 8500, contextWindow: 200_000 }
  })
  expect(contexts.at(-1)).toEqual({ used: 8500, window: 200_000 })
  expect(chatEventFrom({ type: 'message.complete', payload: { status: 'complete', text: 'plain', usage: { context_used: 99 } } })).toEqual({
    type: 'turn.finished',
    status: 'completed',
    text: 'plain',
    contextTokens: 99
  })
})
