import { createRootRoute, createRoute, createRouter, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router'

import { lazy, Suspense, useEffect } from 'react'
import { BotDetailsPanel } from '../bots/bot-details-panel'
import { BotSidebar } from '../bots/bot-sidebar'
import { useBotStore } from '../bots/bot-store'
import { detailsOpenByDefault, useDetailsTab } from '../bots/details-tabs'
import { ChatColumn } from '../chat/chat-column'

// Pages with forms and menus load on first use, so opening the app and its chat stays light.
// The details panel's tabs load the same way (see bot-details-panel.tsx).
const BotCreatePage = lazy(() => import('../bots/bot-create-page').then(module => ({ default: module.BotCreatePage })))

/** Three columns on a wide screen: the roster on the page tint, the conversation on white, the
 *  details panel on the tint again, divided by a hairline. Phone: the roster is the home screen
 *  and a page fills the screen. */
function AppShell() {
  const atHome = useRouterState({ select: state => state.location.pathname === '/' || state.location.pathname === '/bots' })
  return (
    <div className="flex h-dvh bg-background">
      <aside className={`${atHome ? 'flex w-full' : 'hidden'} flex-none flex-col md:flex md:w-[272px] md:border-r md:border-hairline`}>
        <BotSidebar />
      </aside>
      <section className={`${atHome ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col bg-card md:flex`}>
        <Suspense>
          <Outlet />
        </Suspense>
      </section>
    </div>
  )
}

/** A bot's screen: the conversation, with the details panel beside it when a tab is open. The
 *  conversation stays mounted (and connected) while tabs change. A wide screen opens the panel
 *  by itself unless the user closed it; on a phone an open panel covers the conversation. */
function BotLayout() {
  const { botId } = useParams({ from: '/bots/$botId' })
  const tab = useDetailsTab()
  const navigate = useNavigate()
  useEffect(() => {
    if (!tab && detailsOpenByDefault()) void navigate({ to: '/bots/$botId/$tab', params: { botId, tab: 'activity' }, replace: true })
  }, [botId, tab, navigate])
  return (
    <div className="flex h-full min-w-0">
      <div className={`${tab ? 'hidden md:flex' : 'flex'} min-w-0 flex-1 flex-col`}>
        <ChatColumn botId={botId} />
      </div>
      {tab && (
        <aside className="flex w-full flex-none flex-col bg-background md:w-[332px] md:border-l md:border-hairline">
          <Outlet />
        </aside>
      )}
    </div>
  )
}

function Home() {
  const bots = useBotStore(state => state.bots)
  const navigate = useNavigate()
  const primary = bots.find(bot => bot.isPrimary)
  useEffect(() => {
    if (primary) void navigate({ to: '/bots/$botId', params: { botId: primary.id }, replace: true })
  }, [primary?.id, navigate])
  return <p className="m-auto px-6 text-center text-muted-foreground">Choose a bot to chat with.</p>
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
/** Activity, Library, Memory or Setup in the details panel. */
const botTabRoute = createRoute({ getParentRoute: () => botRoute, path: '$tab', component: BotDetailsPanel })

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, rosterRoute, newBotRoute, botRoute.addChildren([botChatRoute, botTabRoute])]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
