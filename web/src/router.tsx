import { createRootRoute, createRoute, createRouter, Outlet, useRouterState } from '@tanstack/react-router'

import { BotCreatePage } from './bots/bot-create-page'
import { BotSettingsPage } from './bots/bot-settings-page'
import { BotSidebar } from './bots/bot-sidebar'
import { ChatPage } from './chat/chat-page'

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

const rootRoute = createRootRoute({ component: AppShell })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <p className="m-auto px-6 text-center text-muted">Pick a bot to chat with, or create a new one.</p>
})
const newBotRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bots/new', component: BotCreatePage })
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bots/$botId', component: ChatPage })
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bots/$botId/settings', component: BotSettingsPage })

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, newBotRoute, chatRoute, settingsRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
