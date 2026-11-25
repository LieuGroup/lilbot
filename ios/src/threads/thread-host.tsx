/** Hosts the currently opened exchange, worker, or temporary group:
 *  - Compact surfaces (Standard iPhone, Folded Duo, Duo Unfolded Portrait): native `pageSheet` modal (`ThreadSheetHost`).
 *  - Split surfaces (Unfolded Duo Landscape, iPad): right-hand inspector pane (`ThreadInspectorPane`). */
import { Modal } from 'react-native'
import { computeShellLayout } from '../duo/layout'
import { useBotSelection } from '../duo/selection'
import { useLiveSurface } from '../duo/use-surface'
import { closeThreadView, useActiveThread } from './store'
import { ThreadView } from './thread-view'

export interface ThreadHostProps {
  onSelectBot?: (botId: string) => void
  onClose?: () => void
}

/** Mounts once in the Tabs root so opening any thread on compact iPhone / Folded Duo slides up a native sheet. */
export function ThreadSheetHost({ onSelectBot, onClose }: ThreadHostProps) {
  const active = useActiveThread()
  const { surface, metrics } = useLiveSurface()
  const select = useBotSelection(state => state.select)
  const layout = computeShellLayout(surface, metrics)
  const visible = active !== null && !layout.splitMode
  const dismiss = onClose ?? closeThreadView

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={dismiss}>
      {active && !layout.splitMode ? (
        <ThreadView
          botId={active.botId}
          threadId={active.threadId}
          mode="sheet"
          onClose={dismiss}
          onSelectBot={botId => {
            if (onSelectBot) onSelectBot(botId)
            else select(botId)
          }}
        />
      ) : null}
    </Modal>
  )
}

/** Renders the opened exchange, worker, or group inside Unfolded Duo / iPad's right-hand inspector pane. */
export function ThreadInspectorPane({ onSelectBot, onClose }: ThreadHostProps) {
  const active = useActiveThread()
  const select = useBotSelection(state => state.select)
  if (!active) return null
  return (
    <ThreadView
      botId={active.botId}
      threadId={active.threadId}
      mode="pane"
      onClose={onClose ?? closeThreadView}
      onSelectBot={botId => {
        if (onSelectBot) onSelectBot(botId)
        else select(botId)
      }}
    />
  )
}
