import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compactModelLabel, modelPillSegments } from '../../ios/src/bots/model-pill-format'
import { COMPOSER_REST_PLACEHOLDER, composerActionState, isComposerExpanded } from '../../ios/src/chat/composer-state'
import { buildTranscriptRows } from '../../ios/src/chat/message-rows'
import { CONTENT_PADDING_VERTICAL, computeRestorePlan, createScrollRestoreController, findScrollAnchor, ROW_GAP, shouldShowScrollToBottom } from '../../ios/src/chat/scroll-restore'

describe('iOS Conversation: exact scroll restore, model-pill Duo formatting, and resting-vs-typing composer', () => {
  test('findScrollAnchor and computeRestorePlan restore exact offset on deep same-width histories', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ key: `id:m-${i}` }))
    const heights: Record<string, number> = {}
    for (let i = 0; i < 40; i++) heights[`id:m-${i}`] = 60 + (i % 5) * 18.33

    // Target sitting 24px into row 22 (accounting for contentContainerStyle paddingVertical).
    let expected = CONTENT_PADDING_VERTICAL + 24
    for (let i = 0; i < 22; i++) expected += heights[`id:m-${i}`] + ROW_GAP

    const anchor = findScrollAnchor(rows, heights, expected, 466)
    expect(anchor?.key).toBe('id:m-22')
    expect(anchor?.offsetWithinRow).toBeCloseTo(24, 5)
    expect(anchor?.viewportWidth).toBe(466)

    // Same width: exact pixel sum matches to the sub-pixel, including gap offsets.
    const plan = computeRestorePlan(rows, heights, anchor, 999, 466)
    expect(plan.kind).toBe('offset')
    if (plan.kind === 'offset') {
      expect(plan.exact).toBe(true)
      expect(plan.offset).toBeCloseTo(expected, 5)
    }

    // Offset landing inside ROW_GAP after row 5 preserves exact sub-gap offset without clamping.
    let inGap = CONTENT_PADDING_VERTICAL
    for (let i = 0; i < 5; i++) inGap += heights[`id:m-${i}`] + ROW_GAP
    inGap += heights['id:m-5'] + 7
    const gapAnchor = findScrollAnchor(rows, heights, inGap, 466)
    const gapPlan = computeRestorePlan(rows, heights, gapAnchor, 0, 466)
    expect(gapPlan.kind).toBe('offset')
    if (gapPlan.kind === 'offset') expect(gapPlan.offset).toBeCloseTo(inGap, 5)

    // Width changed across fold/unfold (466 -> 951): switches to exact row index anchor.
    expect(computeRestorePlan(rows, heights, anchor, expected, 951)).toEqual({ kind: 'index', index: 22 })

    // At bottom (offset <= 2): no anchor and no restore.
    expect(findScrollAnchor(rows, heights, 0, 466)).toBeNull()
    expect(computeRestorePlan(rows, heights, null, 0, 466)).toEqual({ kind: 'none' })
  })

  test('createScrollRestoreController refines across content-size passes and yields immediately on user drag', () => {
    const ctrl = createScrollRestoreController(true, 4)
    expect(ctrl.isRestoring()).toBe(true)
    expect(ctrl.canRecordScroll()).toBe(false)
    expect(ctrl.onContentSize(800, 1200, false)).toBe(true)
    expect(ctrl.onContentSize(1500, 1200, true)).toBe(true)
    // User starts dragging: stops restoring immediately so FlatList never fights their thumb.
    ctrl.onUserDrag()
    expect(ctrl.isRestoring()).toBe(false)
    expect(ctrl.canRecordScroll()).toBe(true)
    expect(ctrl.onContentSize(1800, 1200, true)).toBe(false)
    expect(shouldShowScrollToBottom(100)).toBe(false)
    expect(shouldShowScrollToBottom(300)).toBe(true)
  })

  test('modelPillSegments keeps reasoning effort separate and strips provider slash prefix for Duo', () => {
    expect(compactModelLabel('anthropic/claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(compactModelLabel('Default model')).toBe('Default model')
    expect(modelPillSegments({ label: 'anthropic/claude-opus-5-5', effort: 'High', differs: false })).toEqual({
      model: 'claude-opus-5-5',
      effortSuffix: ' · High',
      accessibilityLabel: 'Model: claude-opus-5-5, High'
    })
    expect(modelPillSegments({ label: 'Choose a model', effort: null, differs: false })).toEqual({
      model: 'Choose a model',
      effortSuffix: null,
      accessibilityLabel: 'Model: Choose a model'
    })
    const pillSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/model-pill.tsx'), 'utf8')
    expect(pillSource).toContain('segments.effortSuffix')
    expect(pillSource).toContain('flexShrink: 0')
  })

  test('resting-vs-typing composer rules hide toolbar at rest, expand on focus/draft/attachments/VoiceOver, and handle attachment-only sends', () => {
    expect(COMPOSER_REST_PLACEHOLDER).toBe('Message')
    expect(isComposerExpanded({ focused: false, draft: '', stagedCount: 0, screenReaderEnabled: false })).toBe(false)
    expect(isComposerExpanded({ focused: true, draft: '', stagedCount: 0, screenReaderEnabled: false })).toBe(true)
    expect(isComposerExpanded({ focused: false, draft: 'hi', stagedCount: 0, screenReaderEnabled: false })).toBe(true)
    expect(isComposerExpanded({ focused: false, draft: '', stagedCount: 1, screenReaderEnabled: false })).toBe(true)
    expect(isComposerExpanded({ focused: false, draft: '', stagedCount: 0, screenReaderEnabled: true })).toBe(true)

    expect(composerActionState({ ready: true, running: false, draft: '', readyAttachments: 1, uploadingAttachments: false })).toEqual({
      hasPayload: true,
      canSend: true,
      stopping: false
    })
    expect(composerActionState({ ready: true, running: false, draft: 'hi', readyAttachments: 0, uploadingAttachments: true })).toEqual({
      hasPayload: true,
      canSend: false,
      stopping: false
    })
    expect(composerActionState({ ready: true, running: true, draft: '', readyAttachments: 0, uploadingAttachments: false })).toEqual({
      hasPayload: false,
      canSend: false,
      stopping: true
    })
  })

  test('buildTranscriptRows marks inTurn and beforeTool accurately for TurnActions visibility', () => {
    const t = Date.UTC(2026, 10, 24, 9, 0, 0)
    const rows = buildTranscriptRows(
      {
        items: [
          { kind: 'assistant', id: 'a1', at: t, text: 'Checking files' },
          { kind: 'tool', id: 't1', at: t + 100, toolId: 'x', name: 'read', detail: 'a.ts', running: false },
          { kind: 'assistant', id: 'a2', at: t + 200, text: 'Done', usage: { inputTokens: 100, outputTokens: 20 } },
          { kind: 'assistant', id: 'a3', at: t + 300, text: 'Streaming...', streaming: true }
        ],
        queued: [],
        first: 0,
        start: null,
        running: true,
        turnStart: 3
      },
      'Atlas',
      t
    )
    const msg = (key: string) => rows.find(r => r.kind === 'message' && r.key === key)
    const r1 = msg('id:a1')
    const r2 = msg('id:a2')
    const r3 = msg('id:a3')
    expect(r1?.kind === 'message' ? { inTurn: r1.inTurn, beforeTool: r1.beforeTool } : null).toEqual({ inTurn: false, beforeTool: true })
    expect(r2?.kind === 'message' ? { inTurn: r2.inTurn, beforeTool: r2.beforeTool } : null).toEqual({ inTurn: false, beforeTool: false })
    expect(r3?.kind === 'message' ? { inTurn: r3.inTurn, beforeTool: r3.beforeTool } : null).toEqual({ inTurn: true, beforeTool: false })
  })
})
