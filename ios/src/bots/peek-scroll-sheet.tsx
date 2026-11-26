/** Bottom sheet whose rows scroll when they are taller than the screen (#313). It measures each row and, when they
 *  do not all fit, stops halfway through a row so about half of the next row shows at the edge; every row is drawn
 *  at full strength. */
import { type ComponentRef, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, type StyleProp, useWindowDimensions, View, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type MenuRowFrame, menuPeekHeight } from './chat-menu'

export interface PeekSheetRow {
  key: string
  node: ReactNode
}

/** Outer padding of the menu Modal around the sheet, top and bottom. */
const SHEET_MARGIN = 12

export function PeekScrollSheet({ rows, style }: { rows: readonly PeekSheetRow[]; style: StyleProp<ViewStyle> }) {
  const { height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null)
  const [frames, setFrames] = useState<Record<string, MenuRowFrame>>({})
  const available = height - insets.top - insets.bottom - SHEET_MARGIN * 2
  const measured = rows.map(row => frames[row.key])
  const peek = measured.every(Boolean) ? menuPeekHeight(measured as MenuRowFrame[], available) : null

  const measure = useCallback((key: string, frame: MenuRowFrame) => {
    setFrames(prev => (prev[key]?.y === frame.y && prev[key]?.height === frame.height ? prev : { ...prev, [key]: frame }))
  }, [])

  useEffect(() => {
    if (peek !== null) scrollRef.current?.flashScrollIndicators()
  }, [peek])

  return (
    <View style={[style, peek === null ? { maxHeight: available } : { height: peek }]}>
      <ScrollView ref={scrollRef} testID="bot-menu-scroll" bounces={false} scrollEnabled={peek !== null} showsVerticalScrollIndicator>
        {rows.map(row => (
          <View key={row.key} onLayout={event => measure(row.key, { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })}>
            {row.node}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}
