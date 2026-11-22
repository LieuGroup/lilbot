import { describe, expect, test } from 'bun:test'

import { compactionLineText, contextDetailView, contextMeterView, formatCompactTokens, formatTokenCount, turnUsageView } from '../../web/src/history/usage-format'

describe('token formatting', () => {
  test('formats full counts with commas and compact counts when the limit is unknown', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(860)).toBe('860')
    expect(formatTokenCount(187_620)).toBe('187,620')
    expect(formatTokenCount(1_000_000)).toBe('1,000,000')

    expect(formatCompactTokens(850)).toBe('850')
    expect(formatCompactTokens(1_500)).toBe('1.5k')
    expect(formatCompactTokens(3_000)).toBe('3k')
    expect(formatCompactTokens(187_620)).toBe('187k')
    expect(formatCompactTokens(1_250_000)).toBe('1.2M')
  })
})

describe('turnUsageView', () => {
  test('builds the breakdown, total, segmented bar and context footer for a normal turn', () => {
    const view = turnUsageView({
      cacheReadTokens: 182_400,
      cacheWriteTokens: 3_120,
      inputTokens: 1_240,
      outputTokens: 860,
      contextTokens: 187_620,
      contextWindow: 1_000_000
    })
    expect(view.empty).toBe(false)
    expect(view.hasBreakdown).toBe(true)
    expect(view.totalLabel).toBe('187,620 tokens')
    expect(view.rows.map(r => [r.label, r.text, r.muted])).toEqual([
      ['Read from cache', '182,400', false],
      ['Written to cache', '3,120', false],
      ['New input', '1,240', false],
      ['Output', '860', false]
    ])
    expect(view.segments.map(s => s.key)).toEqual(['cacheRead', 'cacheWrite', 'input', 'output'])
    expect(view.contextAfter).toBe('187,620 of 1,000,000')
  })

  test('mutes zero cache read and drops zero buckets from the bar after a break', () => {
    const view = turnUsageView({
      cacheReadTokens: 0,
      cacheWriteTokens: 187_620,
      inputTokens: 980,
      outputTokens: 710,
      contextTokens: 189_310,
      contextWindow: 1_000_000
    })
    expect(view.totalLabel).toBe('189,310 tokens')
    expect(view.rows[0]).toMatchObject({ label: 'Read from cache', text: '0', muted: true })
    expect(view.rows[1]).toMatchObject({ label: 'Written to cache', text: '187,620', muted: false })
    expect(view.segments.map(s => s.key)).toEqual(['cacheWrite', 'input', 'output'])
  })

  test('handles absent usage, partial breakdown and context-only usage', () => {
    expect(turnUsageView(undefined)).toMatchObject({
      empty: true,
      hasBreakdown: false,
      emptyNote: 'No numbers were recorded for this turn.',
      totalLabel: null,
      contextAfter: null
    })

    const contextOnly = turnUsageView({ contextTokens: 12_000, contextWindow: 200_000 })
    expect(contextOnly).toMatchObject({
      empty: false,
      hasBreakdown: false,
      emptyNote: 'Token breakdown was not recorded for this turn.',
      totalLabel: null,
      contextAfter: '12,000 of 200,000'
    })

    const partial = turnUsageView({ inputTokens: 80, cacheReadTokens: 12_000, outputTokens: 50, contextTokens: 12_200 })
    expect(partial.emptyNote).toBeNull()
    expect(partial.totalLabel).toBe('12,130 tokens')
    expect(partial.rows[1]).toMatchObject({ label: 'Written to cache', text: '–', muted: true })
    expect(partial.contextAfter).toBe('12,200 tokens')
  })
})

describe('contextMeterView and contextDetailView', () => {
  test('shows a dash until the first turn reports a size, percentage with a limit, and compact count without one', () => {
    expect(contextMeterView(undefined)).toEqual({ label: '–', ratio: null, muted: true })
    expect(contextMeterView({ used: 0, window: 1_000_000 })).toEqual({ label: '–', ratio: null, muted: true })
    expect(contextMeterView({ used: 187_620, window: 1_000_000 })).toEqual({ label: '19%', ratio: 0.18762, muted: false })
    expect(contextMeterView({ used: 1_500, window: 1_000_000 })).toEqual({ label: '<1%', ratio: 0.0015, muted: false })
    expect(contextMeterView({ used: 187_620, window: null })).toEqual({ label: '187k', ratio: null, muted: false })
  })

  test('formats expanded context details with and without a known limit', () => {
    expect(contextDetailView(undefined)).toEqual({ empty: true, percentLabel: null, barValue: null, countLine: 'No size reported yet.' })
    expect(contextDetailView({ used: 0, window: 200_000 })).toEqual({ empty: false, percentLabel: '0% used', barValue: 0, countLine: '0 of 200,000 tokens' })
    expect(contextDetailView({ used: 187_620, window: 1_000_000 })).toEqual({
      empty: false,
      percentLabel: '19% used',
      barValue: 18.762,
      countLine: '187,620 of 1,000,000 tokens'
    })
    expect(contextDetailView({ used: 187_620, window: null })).toEqual({
      empty: false,
      percentLabel: null,
      barValue: null,
      countLine: '187,620 tokens'
    })
  })
})

describe('compactionLineText', () => {
  test('formats before/after sizes and graceful fallbacks', () => {
    expect(compactionLineText({ beforeTokens: 512_300, afterTokens: 38_900 })).toBe('Conversation shortened · 512,300 to 38,900 tokens')
    expect(compactionLineText({ afterTokens: 38_900 })).toBe('Conversation shortened · to 38,900 tokens')
    expect(compactionLineText({ afterTokens: 1 })).toBe('Conversation shortened · to 1 token')
    expect(compactionLineText({ compactedMessages: 18 })).toBe('Conversation shortened · 18 messages')
    expect(compactionLineText({})).toBe('Conversation shortened')
  })
})
