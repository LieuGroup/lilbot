/** Renders one TranscriptRow inside an onLayout wrapper that caches its measured height for exact scroll restore. */
import { memo } from 'react'
import { type LayoutChangeEvent, View } from 'react-native'
import type { Avatar } from '../../../shared/avatar'
import { DateLine, SessionDivider, StartMarker } from '../history/history-marks'
import { ChatItem, type RenderToolItem } from './message-item'
import type { TranscriptRow } from './message-rows'
import { recordRowHeight } from './store'

interface TranscriptRowItemProps {
  row: TranscriptRow
  botId: string
  botName: string
  botAvatar?: Avatar
  deviceId: string
  onChangeModel: () => void
  renderToolItem?: RenderToolItem
}

export const TranscriptRowItem = memo(function TranscriptRowItem({ row, botId, botName, botAvatar, deviceId, onChangeModel, renderToolItem }: TranscriptRowItemProps) {
  const onLayout = (event: LayoutChangeEvent) => recordRowHeight(botId, row.key, event.nativeEvent.layout.height)
  return (
    <View onLayout={onLayout}>
      {row.kind === 'start' ? (
        <StartMarker name={botName} avatar={botAvatar} at={row.at} />
      ) : row.kind === 'date' ? (
        <DateLine at={row.at} />
      ) : row.kind === 'session' ? (
        <SessionDivider at={row.at} reason={row.reason} botName={row.botName} />
      ) : (
        <ChatItem
          item={row.item}
          botName={botName}
          deviceId={deviceId}
          queued={row.queued}
          inTurn={row.inTurn}
          beforeTool={row.beforeTool}
          onChangeModel={onChangeModel}
          renderToolItem={renderToolItem}
        />
      )}
    </View>
  )
})
