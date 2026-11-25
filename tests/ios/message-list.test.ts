import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildTranscriptRows } from '../../ios/src/chat/message-rows'
import type { ChatView } from '../../shared/client/chat/chat-state'

describe('iOS MessageList row building, fold scroll guard, rich markdown, and composer targets', () => {
  test('buildTranscriptRows emits start/day/session markers, preserves queued attachments and references, and keeps invariant keys', () => {
    const day1 = Date.UTC(2026, 10, 20, 10, 0, 0)
    const day2 = Date.UTC(2026, 10, 21, 14, 0, 0)
    const attachment = { id: 'att-1', name: 'spec.pdf', mime: 'application/pdf', size: 1024, state: 'ready' as const, url: '/files/att-1', uploadUrl: '/upload/att-1' }
    const sentUser = { kind: 'user' as const, id: 'u1', at: day1, text: 'Hi' }
    const sentReply = { kind: 'assistant' as const, id: 'a1', at: day1 + 1000, text: 'Hello' }
    const session2 = { kind: 'session' as const, id: 's2', at: day2, text: 'New session' as const }
    const day2User = { kind: 'user' as const, id: 'u2', at: day2 + 1000, text: 'Next day' }
    const queuedWithId = { kind: 'user' as const, text: 'First queued', messageId: 'm-1', attachments: [attachment] }
    const queuedNoId1 = { kind: 'user' as const, text: 'Second queued' }
    const queuedNoId2 = { kind: 'user' as const, text: 'Third queued' }
    const view: Pick<ChatView, 'items' | 'queued' | 'first' | 'start' | 'running' | 'turnStart'> = {
      items: [sentUser, sentReply, session2, day2User],
      queued: [queuedWithId, queuedNoId1, queuedNoId2],
      first: 0,
      start: day1,
      running: false,
      turnStart: null
    }

    const rows = buildTranscriptRows(view, 'Atlas', day2)
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length)
    // Inverted FlatList expects newest first (queued -> day2User -> session2 -> sentReply -> sentUser -> day1 -> start).
    expect(rows[0]?.key).toBe('queued-2')
    expect(rows[1]?.key).toBe('queued-1')
    expect(rows[2]?.key).toBe('queued-m-1')
    expect(rows[2]?.kind === 'message' ? rows[2].item : undefined).toBe(queuedWithId)
    expect(rows[2]?.kind === 'message' && rows[2].item.kind === 'user' ? rows[2].item.attachments : undefined).toEqual([attachment])
    expect(rows[rows.length - 1]).toEqual({ kind: 'start', key: 'start', at: day1 })
    const sessionRow = rows.find(r => r.kind === 'session')
    expect(sessionRow?.kind === 'session' ? sessionRow.botName : undefined).toBe('Atlas')
    // Prepending an older page shifts `first` to -2 but preserves `id:` keys for existing rows.
    const olderUser = { kind: 'user' as const, id: 'u0', at: day1 - 60_000, text: 'Earlier' }
    const prepended = buildTranscriptRows({ ...view, items: [olderUser, ...view.items], first: -1 }, 'Atlas', day2)
    expect(prepended.some(r => r.key === 'id:u1')).toBe(true)
    expect(prepended.some(r => r.key === 'id:a1')).toBe(true)
  })

  test('MessageList guards scroll restoration, memoises renderItem, wires history paging, and gives Composer 44 pt targets', () => {
    const listSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/message-list.tsx'), 'utf8')
    const restoreSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/use-scroll-restore.ts'), 'utf8')
    const composerSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/composer.tsx'), 'utf8')
    const attachSheetSource = readFileSync(resolve(process.cwd(), 'ios/src/attachments/composer-attachments.tsx'), 'utf8')
    expect(restoreSource).toContain('if (!restore.current.canRecordScroll()) return')
    expect(listSource).toContain('onScrollBeginDrag={scroll.handleScrollBeginDrag}')
    expect(listSource).toContain('maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 24 }}')
    expect(listSource).toContain('onEndReached={loadOlder}')
    expect(listSource).toContain('const renderItem = useCallback(')
    expect(listSource).toContain('renderItem={renderItem}')
    expect(listSource).toContain('backgroundColor: theme.card')
    expect(composerSource.match(/<TextInput\b/g)?.length).toBe(1)
    expect(composerSource).toContain('scrollEnabled={expanded}')
    expect(composerSource).toContain('inputRef.current?.focus()')
    expect(composerSource).toContain('maxHeight: composerInputMaxHeight(fontScale)')
    expect(composerSource).toContain('maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.composerInput}')
    expect(composerSource).toContain('onLongPress={openModelFromLongPress}')
    expect(composerSource).toMatch(/onPress=\{onStop\}[\s\S]{0,80}hitSlop=\{4\}[\s\S]{0,80}accessibilityRole="button"/)
    expect(composerSource).toMatch(/onPress=\{submit\}[\s\S]{0,140}hitSlop=\{4\}/)
    expect(attachSheetSource).toContain('onDismiss={handleDismiss}')
    expect(attachSheetSource).toContain('accessible={false}')
  })

  test('Assistant bubble caches markdown styles, puts code-block padding inside ScrollView flush to border, and keeps images/tables bounded', () => {
    const itemSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/message-item.tsx'), 'utf8')
    const rulesSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/markdown-rules.tsx'), 'utf8')
    const chatRouteSource = readFileSync(resolve(process.cwd(), 'ios/src/app/(tabs)/(bots)/chat.tsx'), 'utf8')
    const chatScreenSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/screen.tsx'), 'utf8')
    expect(itemSource).toContain("overflow: 'hidden'")
    expect(itemSource).toContain('paddingVertical: chatScale.bubblePaddingY')
    expect(itemSource).toContain('style={getMarkdownStyle(theme)} rules={markdownRules}')
    expect(rulesSource).toContain('new WeakMap<Palette')
    expect(rulesSource).toContain("Platform.select({ ios: 'Menlo', default: 'monospace' })")
    expect(rulesSource).toContain('styles._VIEW_SAFE_fence')
    expect(rulesSource).toContain("overflow: 'hidden' as const, padding: 0")
    expect(rulesSource).toContain('contentContainerStyle={CODE_BLOCK_PADDING}')
    expect(rulesSource).toContain('style={{ flexGrow: 0, flexShrink: 0 }}')
    expect(rulesSource).toContain("contentContainerStyle={{ alignItems: 'flex-start' }}")
    expect(rulesSource).toContain("bullet_list_content: { flex: undefined, flexGrow: 0, flexShrink: 1, flexBasis: 'auto' }")
    expect(rulesSource).toContain("ordered_list_content: { flex: undefined, flexGrow: 0, flexShrink: 1, flexBasis: 'auto' }")
    expect(rulesSource).toContain('image: { flex: 0,')
    expect(rulesSource).toContain('borderColor: theme.border')
    expect(rulesSource).not.toContain('#000000')
    expect(rulesSource).toContain('body: { color: theme.foreground, gap: 10 }')
    expect(rulesSource).toContain('allowedImageHandlers')
    expect(chatRouteSource).toContain('maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle}')
    expect(chatScreenSource).toContain('maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle}')
  })
})
