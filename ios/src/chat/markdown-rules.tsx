/** Cached per-theme markdown styles and narrow-bubble render rules for assistant replies:
 *  horizontal-scroll monospace code blocks, themed horizontal-scroll tables, bounded clipped images,
 *  and uniform vertical gap spacing so bottom bubble padding never collapses regardless of final block. */
import type { ReactNode } from 'react'
import { Image, Platform, ScrollView, Text, View } from 'react-native'
import type { ASTNode, RenderRules } from 'react-native-markdown-display'
import { MOBILE_SCALE, type Palette } from '../ui/tokens'

const MONOSPACE_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' })
const TABLE_CELL_WIDTH = 112

const styleCache = new WeakMap<Palette, ReturnType<typeof createMarkdownStyle>>()

export function getMarkdownStyle(theme: Palette) {
  const cached = styleCache.get(theme)
  if (cached) return cached
  const created = createMarkdownStyle(theme)
  styleCache.set(theme, created)
  return created
}

function createMarkdownStyle(theme: Palette) {
  const { fontSize, lineHeight } = MOBILE_SCALE.chat.message
  const base = { color: theme.foreground, fontFamily: 'Inter_400Regular', fontSize, lineHeight }
  const codeSize = fontSize - 3
  const codeLine = Math.max(20, lineHeight - 4)
  return {
    body: { color: theme.foreground, gap: 10 },
    paragraph: { marginTop: 0, marginBottom: 0, ...base },
    strong: { fontFamily: 'Inter_600SemiBold' },
    em: { fontStyle: 'italic' as const },
    heading1: { ...base, fontFamily: 'Inter_600SemiBold', fontSize: fontSize + 3, lineHeight: lineHeight + 3, marginTop: 0, marginBottom: 0 },
    heading2: { ...base, fontFamily: 'Inter_600SemiBold', fontSize: fontSize + 2, lineHeight: lineHeight + 2, marginTop: 0, marginBottom: 0 },
    heading3: { ...base, fontFamily: 'Inter_600SemiBold', fontSize: fontSize + 1, lineHeight: lineHeight + 1, marginTop: 0, marginBottom: 0 },
    bullet_list: { marginTop: 0, marginBottom: 0, gap: 4 },
    ordered_list: { marginTop: 0, marginBottom: 0, gap: 4 },
    list_item: { marginTop: 0, marginBottom: 0, ...base },
    bullet_list_icon: { ...base, marginLeft: 4, marginRight: 8 },
    ordered_list_icon: { ...base, marginLeft: 4, marginRight: 8 },
    code_inline: { color: theme.foreground, fontFamily: MONOSPACE_FONT, fontSize: fontSize - 2, lineHeight, backgroundColor: theme.muted, borderWidth: 0, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
    code_block: { color: theme.foreground, fontFamily: MONOSPACE_FONT, fontSize: codeSize, lineHeight: codeLine, backgroundColor: 'transparent', borderWidth: 0, padding: 0, marginTop: 0, marginBottom: 0 },
    fence: { backgroundColor: theme.muted, borderWidth: 1, borderColor: theme.hairline, borderRadius: 10, padding: 12, marginTop: 0, marginBottom: 0 },
    blockquote: { backgroundColor: 'transparent', borderLeftWidth: 3, borderColor: theme.border, paddingLeft: 10, paddingVertical: 2, marginLeft: 0, marginTop: 0, marginBottom: 0 },
    table: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, overflow: 'hidden' as const, marginTop: 0, marginBottom: 0 },
    thead: { backgroundColor: theme.muted },
    tbody: {},
    tr: { flexDirection: 'row' as const, borderBottomWidth: 1, borderColor: theme.hairline },
    th: { flex: 0, width: TABLE_CELL_WIDTH, paddingHorizontal: 10, paddingVertical: 8, borderRightWidth: 1, borderColor: theme.hairline },
    td: { flex: 0, width: TABLE_CELL_WIDTH, paddingHorizontal: 10, paddingVertical: 8, borderRightWidth: 1, borderColor: theme.hairline },
    image: { width: '100%' as const, minWidth: 220, maxWidth: '100%' as const, aspectRatio: 16 / 10, borderRadius: 12, backgroundColor: theme.muted, marginTop: 0, marginBottom: 0 },
    link: { color: theme.primary, textDecorationLine: 'underline' as const },
    hr: { backgroundColor: theme.border, height: 1, marginVertical: 2 }
  }
}

function trimTrailingNewline(content: unknown): string {
  if (typeof content !== 'string') return ''
  return content.endsWith('\n') ? content.slice(0, -1) : content
}

function renderCodeScroll(node: ASTNode, styles: Record<string, unknown>) {
  return (
    <View key={node.key} style={styles.fence as object}>
      <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
        <Text selectable style={styles.code_block as object}>
          {trimTrailingNewline(node.content)}
        </Text>
      </ScrollView>
    </View>
  )
}

export const markdownRules: RenderRules = {
  fence: (node, _children, _parent, styles) => renderCodeScroll(node, styles),
  code_block: (node, _children, _parent, styles) => renderCodeScroll(node, styles),
  table: (node: ASTNode, children: ReactNode, _parent, styles) => (
    <ScrollView key={node.key} horizontal showsHorizontalScrollIndicator nestedScrollEnabled style={{ maxWidth: '100%' }}>
      <View style={styles._VIEW_SAFE_table}>{children}</View>
    </ScrollView>
  ),
  image: (node: ASTNode, _children, _parent, styles, allowedImageHandlers: string[], defaultImageHandler: string | null) => {
    const src = typeof node.attributes?.src === 'string' ? node.attributes.src : ''
    const alt = typeof node.attributes?.alt === 'string' ? node.attributes.alt : undefined
    const allowed = allowedImageHandlers.some(prefix => src.toLowerCase().startsWith(prefix.toLowerCase()))
    if (!allowed && defaultImageHandler === null) return null
    const uri = allowed ? src : `${defaultImageHandler}${src}`
    return <Image key={node.key} source={{ uri }} accessible={Boolean(alt)} accessibilityLabel={alt} resizeMode="cover" style={styles._VIEW_SAFE_image} />
  }
}
