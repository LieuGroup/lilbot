import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildMessageRows } from '../../ios/src/chat/message-rows'
import type { ChatView } from '../../shared/client/chat/chat-state'

describe('iOS MessageList row building, fold scroll guard, rich markdown, and composer targets', () => {
  test('buildMessageRows skips session markers, preserves queued attachments and references, and keeps unique keys', () => {
    const attachment = { id: 'att-1', name: 'spec.pdf', mime: 'application/pdf', size: 1024, state: 'ready' as const, url: '/files/att-1', uploadUrl: '/upload/att-1' }
    const sentUser = { kind: 'user' as const, id: 'u1', text: 'Hi' }
    const sentReply = { kind: 'assistant' as const, id: 'a1', text: 'Hello' }
    const items: ChatView['items'] = [{ kind: 'session', text: 'New conversation' }, sentUser, sentReply]
    const queuedWithId = { kind: 'user' as const, text: 'First queued', messageId: 'm-1', attachments: [attachment] }
    const queuedNoId1 = { kind: 'user' as const, text: 'Second queued' }
    const queuedNoId2 = { kind: 'user' as const, text: 'Third queued' }
    const queued: ChatView['queued'] = [queuedWithId, queuedNoId1, queuedNoId2]

    const rows = buildMessageRows(items, queued)
    expect(rows).toHaveLength(5)
    // Inverted FlatList expects newest first.
    expect(rows.map(r => r.key)).toEqual(['queued-2', 'queued-1', 'queued-m-1', 'item-2', 'item-1'])
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length)
    // Exact object identity preserved for React.memo, and queued attachments retained.
    expect(rows[2]?.item).toBe(queuedWithId)
    expect(rows[2]?.queued).toBe(true)
    expect(rows[2]?.item.kind === 'user' ? rows[2].item.attachments : undefined).toEqual([attachment])
    expect(rows[3]?.item).toBe(sentReply)
    expect(rows[4]?.item).toBe(sentUser)
  })

  test('MessageList guards fold scroll restoration, memoises renderItem, and gives Send/Stop 44 pt targets', () => {
    const listSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/message-list.tsx'), 'utf8')
    expect(listSource).toContain('if (!restored.current) return')
    expect(listSource).toContain('const renderItem = useCallback(')
    expect(listSource).toContain('renderItem={renderItem}')
    expect(listSource).toContain('maxHeight: composerInputMaxHeight(fontScale)')
    expect(listSource).toContain('maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.composerInput}')
    expect(listSource).toMatch(/onPress=\{onStop\}[\s\S]{0,80}hitSlop=\{4\}[\s\S]{0,80}accessibilityRole="button"/)
    expect(listSource).toMatch(/onPress=\{submit\}[\s\S]{0,80}hitSlop=\{4\}/)
  })

  test('Assistant bubble caches markdown styles per theme, clips images, and scrolls code blocks and themed tables', () => {
    const itemSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/message-item.tsx'), 'utf8')
    const rulesSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/markdown-rules.tsx'), 'utf8')
    expect(itemSource).toContain("overflow: 'hidden'")
    expect(itemSource).toContain('paddingVertical: chatScale.bubblePaddingY')
    expect(itemSource).toContain('style={getMarkdownStyle(theme)} rules={markdownRules}')
    expect(rulesSource).toContain('new WeakMap<Palette')
    expect(rulesSource).toContain("Platform.select({ ios: 'Menlo', default: 'monospace' })")
    expect(rulesSource).toContain('<ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>')
    expect(rulesSource).toContain('borderColor: theme.border')
    expect(rulesSource).not.toContain('#000000')
    expect(rulesSource).toContain('body: { color: theme.foreground, gap: 10 }')
    expect(rulesSource).toContain('allowedImageHandlers')
  })
})
