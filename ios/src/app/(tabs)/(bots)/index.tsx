/** Bots tab root screen: hosts the adaptive DuoShell inside the native Bots stack,
 *  wired to the Tasks dock, inline thread lines, and split-mode thread inspector pane. */
import { useCallback } from 'react'
import type { Bot } from '../../../../../shared/bot-schema'
import { DuoShell } from '../../../duo/shell'
import { closeThreadView, useActiveThread } from '../../../threads/store'
import { TaskDockSlot } from '../../../threads/task-dock'
import { ThreadInspectorPane } from '../../../threads/thread-host'
import { createThreadToolRenderer } from '../../../threads/thread-line'

export default function BotsScreen() {
  const activeThread = useActiveThread()
  const renderInspector = useCallback((close: () => void) => <ThreadInspectorPane onClose={close} />, [])
  const renderChatDock = useCallback((bot: Bot) => <TaskDockSlot botId={bot.id} />, [])
  const renderChatToolItem = useCallback((bot: Bot) => createThreadToolRenderer(bot.id), [])

  return (
    <DuoShell
      inspectorOpen={activeThread !== null}
      onCloseInspector={closeThreadView}
      renderInspector={renderInspector}
      renderChatDock={renderChatDock}
      renderChatToolItem={renderChatToolItem}
    />
  )
}
