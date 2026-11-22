import { createRootRoute, createRoute, createRouter, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router'

import { lazy, Suspense, useEffect } from 'react'
import { BotDetailsPanel } from '../bots/bot-details-panel'
import { BotSidebar } from '../bots/bot-sidebar'
import { useBotStore } from '../bots/bot-store'
import { detailsOpenByDefault, useDetailsTab } from '../bots/details-tabs'
import { ChatColumn } from '../chat/chat-column'
import { botSearch, useBotSearch, useOpenThreadId } from '../threads/open-thread'

// Pages with forms and menus load on first use, so opening the app and its chat stays light.
// The details panel's tabs load the same way (see bot-details-panel.tsx).
const BotCreatePage = lazy(() => import('../bots/bot-create-page').then(module => ({ default: module.BotCreatePage })))
const ThreadView = lazy(() => import('../threads/thread-view'))
const RunView = lazy(() => import('../routines/run-view'))
const WebhookRunView = lazy(() => import('../webhooks/webhook-run-view'))
const WorkLayout = lazy(() => import('../work/work-layout'))
const WorkTodayPage = lazy(() => import('../work/work-today-page'))
const WorkAllPage = lazy(() => import('../work/work-all-page'))
const WorkChecksPage = lazy(() => import('../work/work-checks-page'))
const WorkItemPage = lazy(() => import('../work/work-item-page'))
const GoalsTabPage = lazy(() => import('../goals/goals-tab-page'))
const GoalPage = lazy(() => import('../goals/goal-page'))

/** Three columns on a wide screen: the roster on the page tint, the conversation on white, the
 *  details panel on the tint again, divided by a hairline. Phone: the roster is the home screen
 *  and a page fills the screen. */
function AppShell() {
  const atHome = useRouterState({ select: state => state.location.pathname === '/' || state.location.pathname === '/bots' })
  return (
    <div className="flex h-dvh bg-background">
      <aside className={`${atHome ? 'flex w-full' : 'hidden'} flex-none flex-col md:flex md:w-auto md:border-r md:border-hairline`}>
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
 *  by itself unless the user closed it; on a phone an open panel covers the conversation. An
 *  exchange between bots, or a routine or webhook run, opens over the conversation, which stays mounted,
 *  connected and scrolled where it was underneath. */
function BotLayout() {
  const { botId } = useParams({ from: '/bots/$botId' })
  const bots = useBotStore(state => state.bots)
  const loaded = useBotStore(state => state.loaded)
  const tab = useDetailsTab()
  const thread = useOpenThreadId()
  const run = useBotSearch('run')
  const webhookRun = useBotSearch('webhookRun')
  const covered = !!(thread || run || webhookRun)
  const navigate = useNavigate()
  const missing = loaded && !bots.some(bot => bot.id === botId)
  const fallback = bots.find(bot => bot.isPrimary) ?? bots[0]
  useEffect(() => {
    if (missing && fallback) {
      void navigate(
        tab
          ? { to: '/bots/$botId/$tab', params: { botId: fallback.id, tab }, search: {}, replace: true }
          : { to: '/bots/$botId', params: { botId: fallback.id }, search: {}, replace: true }
      )
      return
    }
    if (!missing && !tab && detailsOpenByDefault()) void navigate({ to: '/bots/$botId/$tab', params: { botId, tab: 'activity' }, search: true, replace: true })
  }, [missing, fallback?.id, botId, tab, navigate])
  if (missing && fallback) return null
  return (
    <div className="flex h-full min-w-0">
      <div className={`${tab ? 'hidden md:flex' : 'flex'} relative min-w-0 flex-1 flex-col`}>
        <div className={`flex min-h-0 flex-1 flex-col ${covered ? 'invisible' : ''}`} inert={covered}>
          <ChatColumn botId={botId} />
        </div>
        {covered && (
          <div className="absolute inset-0 flex flex-col bg-card">
            <Suspense>
              {thread ? (
                <ThreadView key={thread} botId={botId} threadId={thread} />
              ) : run ? (
                <RunView key={run} botId={botId} runId={run} />
              ) : (
                webhookRun && <WebhookRunView key={webhookRun} botId={botId} runId={webhookRun} />
              )}
            </Suspense>
          </div>
        )}
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
const botRoute = createRoute({ getParentRoute: () => rootRoute, path: '/bots/$botId', component: BotLayout, validateSearch: botSearch })
const botChatRoute = createRoute({ getParentRoute: () => botRoute, path: '/', component: () => null })
/** Activity, Library, Memory or Setup in the details panel. */
const botTabRoute = createRoute({ getParentRoute: () => botRoute, path: '$tab', component: BotDetailsPanel })

/** Work board: Today's brief, All work, Goals, Checks, plus item and goal detail pages (Paper artboard 20). */
const workRoute = createRoute({ getParentRoute: () => rootRoute, path: '/work', component: WorkLayout })
const workTodayRoute = createRoute({ getParentRoute: () => workRoute, path: '/', component: WorkTodayPage })
const workAllRoute = createRoute({ getParentRoute: () => workRoute, path: 'all', component: WorkAllPage })
const workGoalsRoute = createRoute({ getParentRoute: () => workRoute, path: 'goals', component: GoalsTabPage })
const workChecksRoute = createRoute({ getParentRoute: () => workRoute, path: 'checks', component: WorkChecksPage })
const workItemRoute = createRoute({ getParentRoute: () => workRoute, path: 'items/$itemId', component: WorkItemPage })
const workGoalRoute = createRoute({
  getParentRoute: () => workRoute,
  path: 'goals/$goalId',
  component: GoalPage,
  validateSearch: (search: Record<string, unknown>): { review?: string } => (typeof search.review === 'string' && search.review ? { review: search.review } : {})
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    rosterRoute,
    newBotRoute,
    botRoute.addChildren([botChatRoute, botTabRoute]),
    workRoute.addChildren([workTodayRoute, workAllRoute, workGoalsRoute, workChecksRoute, workItemRoute, workGoalRoute])
  ])
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
