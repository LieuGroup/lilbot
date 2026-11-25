/** Bots tab root screen: hosts the adaptive DuoShell inside the native Bots stack,
 *  wired to the Tasks dock, inline work/thread lines, and split-mode thread inspector pane. */
import { useRouter } from 'expo-router'
import { useCallback } from 'react'
import type { Bot } from '../../../../../shared/bot-schema'
import { DuoShell } from '../../../duo/shell'
import { closeThreadView, useActiveThread } from '../../../threads/store'
import { TaskDockSlot } from '../../../threads/task-dock'
import { ThreadInspectorPane } from '../../../threads/thread-host'
import { createThreadToolRenderer } from '../../../threads/thread-line'
import { withWorkToolRenderer } from '../../../work/work-line'

export default function BotsScreen() {
  const router = useRouter()
  const activeThread = useActiveThread()
  const openWorkItem = useCallback(
    (itemId: string) => {
      router.push({ pathname: '/(tabs)/(work)/item', params: { itemId } })
    },
    [router]
  )
  const renderInspector = useCallback((close: () => void) => <ThreadInspectorPane onClose={close} />, [])
  const renderChatDock = useCallback((bot: Bot) => <TaskDockSlot botId={bot.id} />, [])
  const renderChatToolItem = useCallback((bot: Bot) => withWorkToolRenderer(openWorkItem, createThreadToolRenderer(bot.id)), [openWorkItem])

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
