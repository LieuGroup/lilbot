import { Link } from '@tanstack/react-router'
import { PanelRightIcon, SquarePenIcon } from 'lucide-react'
import { Button } from '@/ui/button'
import { ComposerNote } from '@/ui/composer-note'
import { iconButton } from '@/ui/icon-button'
import { PageHeader } from '@/ui/page-header'
import { DropOverlay, useFileDrop } from '../attachments/file-drop'
import { useStagedAttachments } from '../attachments/use-staged-attachments'
import { useBotStore } from '../bots/bot-store'
import { rememberDetailsOpen, useDetailsTab } from '../bots/details-tabs'
import { dismissModelError, useModelPicker } from '../bots/model-picker-target'
import { ModelPill } from '../bots/model-pill'
import { Composer } from './composer'
import { MessageList } from './message-list'
import { useChat } from './use-chat'

/** The conversation with one bot. It stays open while the details panel beside it changes. */
export function ChatColumn({ botId }: { botId: string }) {
  const bot = useBotStore(state => state.bots.find(candidate => candidate.id === botId))
  const connected = useBotStore(state => state.connected)
  const tab = useDetailsTab()
  const { chat, ready, error, send, stop, newChat } = useChat(botId)
  const staged = useStagedAttachments(botId)
  const modelError = useModelPicker(state => (state.error?.botId === botId ? state.error.message : ''))
  const drop = useFileDrop(files => void staged.add(files), ready)
  const name = bot?.name ?? botId
  const hint = error || (!connected ? 'Reconnecting...' : !ready ? 'Opening chat...' : `Send a message to start with ${name}.`)

  return (
    <div className="flex h-full min-w-0 flex-col bg-card" {...drop.handlers}>
      <PageHeader
        title={name}
        subtitle={bot?.function}
        actions={
          <>
            <Button variant="ghost" size="icon-sm" className={iconButton()} onClick={newChat} disabled={!ready} aria-label="New session" title="Start a new session with this bot">
              <SquarePenIcon />
            </Button>
            {tab ? (
              <Link
                to="/bots/$botId"
                params={{ botId }}
                onClick={() => rememberDetailsOpen(false)}
                aria-label="Hide details"
                title="Hide details"
                className={iconButton({ on: true })}
              >
                <PanelRightIcon />
              </Link>
            ) : (
              <Link
                to="/bots/$botId/$tab"
                params={{ botId, tab: 'activity' }}
                onClick={() => rememberDetailsOpen(true)}
                aria-label="Show details"
                title="Show details"
                className={iconButton()}
              >
                <PanelRightIcon />
              </Link>
            )}
          </>
        }
      />
      {/* A new scroller per bot, so each opens at its latest message; a new session stays in it. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <MessageList key={chat.load > 0 ? botId : `${botId}:opening`} botId={botId} botName={name} avatar={bot?.prefs.avatar} chat={chat} emptyHint={hint} />
        {drop.dragging && <DropOverlay limits={staged.limits} />}
      </div>
      <Composer
        disabled={!ready}
        disabledHint={!connected ? 'Reconnecting...' : error || 'Opening chat...'}
        running={chat.running}
        botName={name}
        staged={staged}
        model={<ModelPill botId={botId} disabled={!connected} />}
        note={
          modelError && (
            <ComposerNote label="Dismiss" onDismiss={dismissModelError}>
              <p className="text-[13px]/[18px] text-destructive">The model was not changed. {modelError}</p>
            </ComposerNote>
          )
        }
        onSend={send}
        onStop={stop}
      />
    </div>
  )
}
