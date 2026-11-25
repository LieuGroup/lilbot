/** Bots tab root screen: hosts the adaptive DuoShell inside the native Bots stack,
 *  wired to the Tasks dock, inline thread lines, split-mode thread inspector, and Bot Details inspector. */
import { useCallback } from 'react'
import type { Bot } from '../../../../../shared/bot-schema'
import { BotDetailsScreen } from '../../../bots/details-screen'
import { useBotSelection } from '../../../duo/selection'
import { DuoShell } from '../../../duo/shell'
import { closeThreadView, useActiveThread } from '../../../threads/store'
import { TaskDockSlot } from '../../../threads/task-dock'
import { ThreadInspectorPane } from '../../../threads/thread-host'
import { createThreadToolRenderer } from '../../../threads/thread-line'

export default function BotsScreen() {
  const activeThread = useActiveThread()
  const selectedId = useBotSelection(state => state.selectedId)
  const renderInspector = useCallback(
    (close: () => void) => {
      if (activeThread !== null) return <ThreadInspectorPane onClose={close} />
      return selectedId ? <BotDetailsScreen botId={selectedId} compact /> : null
    },
    [activeThread, selectedId]
  )
  const renderChatDock = useCallback((bot: Bot) => <TaskDockSlot botId={bot.id} />, [])
  const renderChatToolItem = useCallback((bot: Bot) => createThreadToolRenderer(bot.id), [])

  return (
    <DuoShell
      inspectorOpen={activeThread !== null ? true : undefined}
      onCloseInspector={closeThreadView}
      renderInspector={activeThread !== null || selectedId ? renderInspector : undefined}
      renderChatDock={renderChatDock}
      renderChatToolItem={renderChatToolItem}
    />
  )
}
