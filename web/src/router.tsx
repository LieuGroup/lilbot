import { createRootRoute, createRoute, createRouter, Outlet, useParams, useRouterState } from '@tanstack/react-router'

import { BotCreatePage } from './bots/bot-create-page'
import { BotSetupPanel } from './bots/bot-setup-panel'
import { BotSidebar } from './bots/bot-sidebar'
import { ChatColumn } from './chat/chat-column'

/** Desktop: bot list beside the page. Phone: the bot list is the home screen, a page fills the screen. */
function AppShell() {
  const atHome = useRouterState({ select: state => state.location.pathname === '/' })
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
  const panelOpen = useRouterState({ select: state => state.matches.some(match => match.routeId === '/bots/$botId/setup') })
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

const rootRoute = createRootRoute({ component: AppShell })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <p className="m-auto px-6 text-center text-muted">Pick a bot to chat with, or create a new one.</p>
})
const newBotRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bots/new', component: BotCreatePage })
const botRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bots/$botId', component: BotLayout })
const botChatRoute = createRoute({ getParentRoute: () => botRoute, path: '/', component: () => null })
const botSetupRoute = createRoute({ getParentRoute: () => botRoute, path: 'setup', component: BotSetupPanel })

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, newBotRoute, botRoute.addChildren([botChatRoute, botSetupRoute])]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
