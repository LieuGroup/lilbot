import { expect, test } from 'bun:test'
import { MAX_TRANSCRIPT_BYTES, prepareTranscriptItems } from '../../server/routines/transcript-bounds'
import type { ChatItem } from '../../shared/chat-schema'

const utf8Bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')

test('prepareTranscriptItems strips user messages, sign-in cards, and tool results, and caps tool detail', () => {
  const longDetail = 'cmd '.repeat(200)
  const input: ChatItem[] = [
    { kind: 'user', text: 'Webhook payload {"secret":"SHOULD_NEVER_SAVE"}' },
    { kind: 'tool', toolId: 't1', name: 'terminal', detail: longDetail, running: true, failed: true, result: 'RAW_OUTPUT_5MB' },
    {
      kind: 'connection.sign_in',
      card: {
        id: 'c1',
        connectionId: 's1',
        botId: 'b1',
        chatId: 'ch1',
        serviceName: 'Svc',
        serviceAddress: 'https://example.com/mcp',
        providerDomain: 'example.com',
        state: 'waiting',
        createdAt: 1,
        expiresAt: 2,
        settledAt: null
      }
    },
    { kind: 'assistant', text: 'Summary.', stopped: true, usage: { inputTokens: 3, outputTokens: 2 } },
    { kind: 'error', text: 'ignored', reason: 'memory_save' }
  ]
  const out = prepareTranscriptItems(input)
  expect(out).toHaveLength(3)
  expect(out[0]).toMatchObject({ kind: 'tool', toolId: 't1', name: 'terminal', running: false, failed: true })
  expect('result' in out[0]).toBe(false)
  expect((out[0] as Extract<ChatItem, { kind: 'tool' }>).detail.length).toBeLessThanOrEqual(500)
  expect(out[1]).toEqual({ kind: 'assistant', text: 'Summary.', stopped: true, usage: { inputTokens: 3, outputTokens: 2 } })
  expect(out[2]).toEqual({ kind: 'error', text: '', reason: 'memory_save' })
  expect(JSON.stringify(out)).not.toContain('SHOULD_NEVER_SAVE')
  expect(JSON.stringify(out)).not.toContain('RAW_OUTPUT_5MB')
})

test('oversized multi-item transcript is bounded to MAX_TRANSCRIPT_BYTES and keeps start and end with an omitted marker', () => {
  const many: ChatItem[] = [
    { kind: 'tool', toolId: 'first-tool', name: 'terminal', detail: 'FIRST_STEP', running: false, result: 'x'.repeat(100_000) },
    ...Array.from({ length: 80 }, (_, i) => ({
      kind: 'assistant' as const,
      text: `Step ${i}: ${'a'.repeat(8_000)}`
    })),
    { kind: 'assistant', text: 'FINAL_ANSWER_KEPT' }
  ]
  const out = prepareTranscriptItems(many)
  expect(utf8Bytes(out)).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES)
  expect(out[0]).toMatchObject({ kind: 'tool', detail: 'FIRST_STEP' })
  expect(out.at(-1)).toEqual({ kind: 'assistant', text: 'FINAL_ANSWER_KEPT' })
  const marker = out.find(item => item.kind === 'omitted')
  expect(marker).toBeDefined()
  expect((marker as Extract<ChatItem, { kind: 'omitted' }>).text).toContain('not kept')
})

test('a single oversized assistant message keeps its start and end with an omitted marker within the byte cap', () => {
  const huge = `BEGIN_MARKER_${'m'.repeat(400_000)}_END_MARKER`
  const out = prepareTranscriptItems([{ kind: 'assistant', text: huge, stopped: true }])
  expect(utf8Bytes(out)).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES)
  expect(out.map(i => i.kind)).toEqual(['assistant', 'omitted', 'assistant'])
  expect((out[0] as Extract<ChatItem, { kind: 'assistant' }>).text.startsWith('BEGIN_MARKER_')).toBe(true)
  expect((out[2] as Extract<ChatItem, { kind: 'assistant' }>).text.endsWith('_END_MARKER')).toBe(true)
  expect((out[2] as Extract<ChatItem, { kind: 'assistant' }>).stopped).toBe(true)
})

test('oversized first and last items both keep bounded start and end around an omitted marker without splitting UTF-16 surrogates', () => {
  const first = `START_${'🚀'.repeat(600)}`
  const last = `${'🎯'.repeat(600)}_FINISH`
  const out = prepareTranscriptItems(
    [
      { kind: 'assistant', text: first },
      { kind: 'assistant', text: 'middle' },
      { kind: 'assistant', text: last }
    ],
    2048
  )
  expect(utf8Bytes(out)).toBeLessThanOrEqual(2048)
  expect(out.map(i => i.kind)).toEqual(['assistant', 'omitted', 'assistant'])
  const headText = (out[0] as Extract<ChatItem, { kind: 'assistant' }>).text
  const tailText = (out[2] as Extract<ChatItem, { kind: 'assistant' }>).text
  expect(headText.startsWith('START_')).toBe(true)
  expect(tailText.endsWith('_FINISH')).toBe(true)
  // Valid UTF-16 (no lone surrogate code units)
  expect(Buffer.from(headText, 'utf8').toString('utf8')).toBe(headText)
  expect(Buffer.from(tailText, 'utf8').toString('utf8')).toBe(tailText)
})
