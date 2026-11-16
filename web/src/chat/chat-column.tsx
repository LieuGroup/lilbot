import { Link } from '@tanstack/react-router'

import { useBotStore } from '../bots/bot-store'
import { Button } from '../ui/controls'
import { PageHeader } from '../ui/page-header'
import { Composer } from './composer'
import { MessageList } from './message-list'
import { useChat } from './use-chat'

/** The conversation with one bot. It stays open while the details panel beside it changes. */
export function ChatColumn({ botId }: { botId: string }) {
  const bot = useBotStore(state => state.bots.find(candidate => candidate.id === botId))
  const connected = useBotStore(state => state.connected)
  const { chat, ready, error, send, stop, newChat } = useChat(botId)
  const name = bot?.name ?? botId
  const hint = error || (!connected ? 'Connecting...' : !ready ? 'Opening chat...' : `Send a message to start with ${name}.`)

  return (
    <div className="flex h-full min-w-0 flex-col">
      <PageHeader
        title={name}
        subtitle={chat.title || bot?.function}
        actions={
          <>
            <Link to="/bots/$botId/memory" params={{ botId }} className="rounded-xl border border-border px-3 py-1.5 text-sm font-medium">
              Memory
            </Link>
            <Link to="/bots/$botId/setup" params={{ botId }} className="rounded-xl border border-border px-3 py-1.5 text-sm font-medium">
              Setup
            </Link>
            <Button variant="ghost" className="min-h-0 px-3 py-1.5 text-sm" onClick={newChat} disabled={!ready} title="Start a new session with this bot">
              New session
            </Button>
          </>
        }
      />
      <MessageList items={chat.items} queued={chat.queued} activity={chat.running ? chat.activity : ''} emptyHint={hint} />
      <Composer disabled={!ready} running={chat.running} botName={name} onSend={send} onStop={stop} />
    </div>
  )
}
