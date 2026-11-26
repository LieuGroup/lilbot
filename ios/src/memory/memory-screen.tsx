/** Settings > Memory, the one place to see and correct what the bots remember. Every page is the `[section]` route
 *  pushed with its own params (Memory, one bot's facts, Removed facts, and on a Duo an opened fact), so Back and the
 *  edge swipe return one page. Phone: system Back, the title and + in the header, an opened fact in a sheet. Duo with
 *  the side strip: no header row, the title inline, Search and Add (or Pause and Forget) in the strip. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, type ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { MemoryFact } from '../../../shared/memory-schema'
import { useBotStore } from '../bots/store'
import { useLiveSurface, useVerticalBarEdge } from '../duo/use-surface'
import { buildDuoVerticalBarItems, duoVerticalHeaderOptions, isDuoVerticalBarActive, type VerticalBarActionMap } from '../duo/vertical-bar'
import { PlusIcon } from '../ui/icon'
import { useTheme } from '../ui/theme'
import { AddFactForm } from './memory-add-form'
import { FactPage, FactSheet } from './memory-fact'
import { MemoryMain, type SearchInput } from './memory-main'
import { MemoryNote, MemoryScroll } from './memory-parts'
import { BotFacts, RemovedFacts } from './memory-sub-pages'
import { type MemoryRoute, memoryRoute, memoryRouteParams, memoryStripScreen, memoryTitle } from './memory-view'
import { type NewFact, useMemoryActions, useMemorySeen } from './use-memory-actions'

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}

export function MemoryScreen() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams()
  const routeKey = JSON.stringify(memoryRoute(params))
  const route: MemoryRoute = useMemo(() => JSON.parse(routeKey), [routeKey])
  const { surface } = useLiveSurface()
  const stripActive = isDuoVerticalBarActive({ surface, verticalBarEdge: useVerticalBarEdge() })
  const bots = useBotStore(state => state.bots)
  const seen = useMemorySeen()
  const actions = useMemoryActions()
  const now = useNow(60_000)
  const searchRef = useRef<SearchInput>(null)
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [botName, setBotName] = useState('')

  const push = useCallback((next: MemoryRoute) => router.push({ pathname: '/(tabs)/(settings)/[section]', params: memoryRouteParams(next) }), [router])
  const openFact = useCallback((fact: MemoryFact) => (stripActive ? push({ view: 'fact', factId: fact.id }) : setOpenId(fact.id)), [push, stripActive])

  /** Turning a Duo so the strip appears moves an open sheet to its own page, so the fact stays open. */
  useEffect(() => {
    if (!stripActive || !openId) return
    setOpenId(null)
    push({ view: 'fact', factId: openId })
  }, [openId, push, stripActive])

  const factId = route.view === 'fact' ? route.factId : openId
  const fact = factId ? seen.facts[factId] : undefined
  const nameOf = (botId: string) => seen.names[botId] ?? bots.find(bot => bot.id === botId)?.name ?? 'A removed bot'
  const forget = useCallback(
    async (target: MemoryFact) => {
      if (!(await actions.forget(target))) return
      if (route.view === 'fact') router.back()
      else setOpenId(null)
    },
    [actions.forget, route.view, router]
  )
  const add = useCallback(async (next: NewFact) => {
    const done = await actions.add(next)
    if (done) setAdding(false)
    return done
  }, [actions.add])
  const title = memoryTitle(route, botName)

  const stripActions = useMemo((): VerticalBarActionMap => {
    const focusSearch = () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true })
      searchRef.current?.focus()
    }
    if (route.view === 'main') return { 'search-memory': { onPress: focusSearch }, 'add-fact': { onPress: () => setAdding(true) } }
    if (route.view !== 'fact' || !fact) return {}
    return {
      'pause-fact': { label: fact.paused ? 'Resume' : 'Pause', sfSymbol: fact.paused ? 'play' : 'pause', disabled: actions.busy, onPress: () => void actions.pause(fact) },
      'forget-fact': { label: 'Forget', tintColor: theme.destructive, disabled: actions.busy, onPress: () => void forget(fact) }
    }
  }, [route.view, fact, actions.busy, actions.pause, forget, theme.destructive])

  const options = useMemo(() => {
    if (stripActive) {
      const items = buildDuoVerticalBarItems({ screen: memoryStripScreen(route), actions: stripActions, tintColor: theme.foreground })
      return { ...duoVerticalHeaderOptions(items, theme.foreground, { backVisible: true, keepTransparentWhenEmpty: true }), headerTitle: '', headerRight: undefined, gestureEnabled: true }
    }
    const addButton = (
      <Pressable testID="memory-add" onPress={() => setAdding(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add a fact" style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
        <PlusIcon color={theme.foreground} size={20} />
      </Pressable>
    )
    return { headerShown: true, headerTransparent: false, headerTitle: title, headerBackVisible: true, unstable_headerRightItems: undefined, headerRight: route.view === 'main' ? () => addButton : undefined, gestureEnabled: true }
  }, [stripActive, route, stripActions, theme.foreground, title])

  const page =
    route.view === 'bot' ? (
      <BotFacts botId={route.botId} name={route.name} now={now} onOpenFact={openFact} onName={setBotName} />
    ) : route.view === 'removed' ? (
      <RemovedFacts busy={actions.busy} onRestore={fact => void actions.restore(fact)} />
    ) : route.view === 'fact' ? (
      fact ? (
        <FactPage fact={fact} botName={nameOf(fact.botId)} now={now} busy={actions.busy} error={actions.error} showActions={!stripActive} onPause={() => void actions.pause(fact)} onForget={() => void forget(fact)} />
      ) : (
        <MemoryNote>Nothing here any more.</MemoryNote>
      )
    ) : (
      <MemoryMain
        bots={bots}
        now={now}
        busy={actions.busy}
        searchRef={searchRef}
        onOpenFact={openFact}
        onOpenBot={(botId, name) => push({ view: 'bot', botId, name })}
        onOpenRemoved={() => push({ view: 'removed' })}
        onConnect={page => void actions.connect(page)}
      />
    )

  return (
    <View style={{ flex: 1, paddingTop: stripActive ? insets.top : 0 }}>
      <Stack.Screen options={options} />
      <MemoryScroll scrollRef={scrollRef} testID={`memory-screen-${route.view}`} title={stripActive && route.view !== 'fact' ? title : undefined}>
        {route.view !== 'fact' && actions.error ? <MemoryNote tone="error">{actions.error}</MemoryNote> : null}
        {page}
      </MemoryScroll>
      {route.view !== 'fact' && fact && !stripActive ? (
        <FactSheet visible fact={fact} botName={nameOf(fact.botId)} now={now} busy={actions.busy} error={actions.error} onClose={() => setOpenId(null)} onPause={() => void actions.pause(fact)} onForget={() => void forget(fact)} />
      ) : null}
      <AddFactForm visible={adding} bots={bots} busy={actions.busy} error={actions.error} onCancel={() => setAdding(false)} onAdd={add} />
    </View>
  )
}
