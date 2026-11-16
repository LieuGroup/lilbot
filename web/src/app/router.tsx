import { createRootRoute, createRoute, createRouter, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router'

import { useEffect } from 'react'
import { BotCreatePage } from '../bots/bot-create-page'
import { BotSetupPanel } from '../bots/bot-setup-panel'
import { BotSidebar } from '../bots/bot-sidebar'
import { useBotStore } from '../bots/bot-store'
import { primaryBot } from '../bots/primary-bot'
import { ChatColumn } from '../chat/chat-column'
import { MemoryPanel } from '../memory/memory-panel'

/** Desktop: bot list beside the page. Phone: the bot list is the home screen, a page fills the screen. */
function AppShell() {
  const atHome = useRouterState({ select: state => state.location.pathname === '/' || state.location.pathname === '/bots' })
  return (
    <div className="flex h-dvh">
      <aside className={`${atHome ? 'flex w-full' : 'hidden'} flex-none flex-col border-r border-border md:flex md:w-72`}>
        <BotSidebar />
      </aside>
      <section className={`${atHome ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col md:flex`}>
        <Outlet />
      </section>
    </div>
  )
}

/** A bot's screen: the conversation, with an optional details panel beside it. The conversation
 *  stays mounted (and connected) while panels open, change and close. On a phone an open panel
 *  covers the conversation. */
function BotLayout() {
  const { botId } = useParams({ from: '/bots/$botId' })
  // Any child route other than the plain chat is a panel.
  const panelOpen = useRouterState({ select: state => state.matches.some(match => match.routeId.startsWith('/bots/$botId/') && match.routeId !== '/bots/$botId/') })
  return (
    <div className="flex h-full min-w-0">
      <div className={`${panelOpen ? 'hidden md:flex' : 'flex'} min-w-0 flex-1 flex-col`}>
        <ChatColumn botId={botId} />
      </div>
      {panelOpen && (
        <aside className="flex w-full flex-none flex-col border-border md:w-[26rem] md:border-l">
          <Outlet />
        </aside>
      )}
    </div>
  )
}

function Home() {
  const bots = useBotStore(state => state.bots)
  const navigate = useNavigate()
  const primary = primaryBot(bots)
  useEffect(() => {
    if (primary) void navigate({ to: '/bots/$botId', params: { botId: primary.id }, replace: true })
  }, [primary?.id, navigate])
  return <p className="m-auto px-6 text-center text-muted">Choose a bot to chat with.</p>
}

const rootRoute = createRootRoute({ component: AppShell })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home
})
const rosterRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bots', component: () => null })
const newBotRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bots/new', component: BotCreatePage })
const botRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bots/$botId', component: BotLayout })
const botChatRoute = createRoute({ getParentRoute: () => botRoute, path: '/', component: () => null })
const botSetupRoute = createRoute({ getParentRoute: () => botRoute, path: 'setup', component: BotSetupPanel })
const botMemoryRoute = createRoute({ getParentRoute: () => botRoute, path: 'memory', component: MemoryPanel })

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, rosterRoute, newBotRoute, botRoute.addChildren([botChatRoute, botSetupRoute, botMemoryRoute])]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
