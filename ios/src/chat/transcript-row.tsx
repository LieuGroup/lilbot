/** Renders one TranscriptRow inside an onLayout wrapper that caches its measured height for exact scroll restore.
 *  Uses a value-based memo comparator so streaming `text.delta` re-renders only the active streaming row. */
import { memo } from 'react'
import { type LayoutChangeEvent, View } from 'react-native'
import type { Avatar } from '../../../shared/avatar'
import { DateLine, SessionDivider, StartMarker } from '../history/history-marks'
import { ChatItem, type RenderToolItem } from './message-item'
import { sameTranscriptRow, type TranscriptRow } from './message-rows'
import { recordRowHeight } from './store'

export interface TranscriptRowItemProps {
  row: TranscriptRow
  botId: string
  botName: string
  botAvatar?: Avatar
  deviceId: string
  onChangeModel: () => void
  renderToolItem?: RenderToolItem
}

function areTranscriptRowPropsEqual(prev: TranscriptRowItemProps, next: TranscriptRowItemProps): boolean {
  return (
    prev.botId === next.botId &&
    prev.botName === next.botName &&
    prev.botAvatar === next.botAvatar &&
    prev.deviceId === next.deviceId &&
    prev.onChangeModel === next.onChangeModel &&
    prev.renderToolItem === next.renderToolItem &&
    sameTranscriptRow(prev.row, next.row)
  )
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
}, areTranscriptRowPropsEqual)
