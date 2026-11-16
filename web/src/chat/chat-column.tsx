import { Link } from '@tanstack/react-router'
import { BrainIcon, SettingsIcon, SquarePenIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/ui/button'
import { PageHeader } from '@/ui/page-header'
import { useBotStore } from '../bots/bot-store'
import { Composer } from './composer'
import { MessageList } from './message-list'
import { useChat } from './use-chat'

const headerButton = buttonVariants({ variant: 'outline', size: 'lg', className: 'px-2.5 max-sm:size-9 max-sm:px-0' })

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
            <Link to="/bots/$botId/memory" params={{ botId }} aria-label="Memory" className={headerButton}>
              <BrainIcon />
              <span className="max-sm:sr-only">Memory</span>
            </Link>
            <Link to="/bots/$botId/setup" params={{ botId }} aria-label="Setup" className={headerButton}>
              <SettingsIcon />
              <span className="max-sm:sr-only">Setup</span>
            </Link>
            <Button variant="outline" className={headerButton} onClick={newChat} disabled={!ready} aria-label="New session" title="Start a new session with this bot">
              <SquarePenIcon />
              <span className="max-sm:sr-only">New session</span>
            </Button>
          </>
        }
      />
      {/* A new scroller per conversation, so each one opens at its latest message. */}
      <MessageList key={chat.chatId || botId} items={chat.items} queued={chat.queued} activity={chat.running ? chat.activity : ''} emptyHint={hint} />
      <Composer disabled={!ready} running={chat.running} botName={name} onSend={send} onStop={stop} />
    </div>
  )
}
