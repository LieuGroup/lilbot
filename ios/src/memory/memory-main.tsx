/** Memory as it opens: the search field, then facts every bot sees (the first five, then "Show N more"), the bots that
 *  know facts of their own, and the removed-facts link. With words in the search field, the matching facts from all of
 *  memory instead. The same lists and wording as the web's `memory-main.tsx`. */
import { type ComponentRef, type RefObject, useEffect, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { MEMORY_TITLES, matchLine, notConnectedLine } from '../../../shared/client/memory/memory-lines'
import type { MemoryBrowsePage, MemoryFact } from '../../../shared/memory-schema'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { SearchIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { factOwners, sharedShown } from './memory-view'
import { MemoryGroup, MemoryNote, MemoryStatus } from './memory-parts'
import { BotRow, FactRow, MoreRow, RemovedLink } from './memory-rows'
import { rememberPage } from './use-memory-actions'
import { useMemoryList } from './use-memory-list'

export type SearchInput = ComponentRef<typeof TextInput>

export interface MemoryMainProps {
  bots: Bot[]
  now: number
  busy: boolean
  searchRef: RefObject<SearchInput | null>
  onOpenFact: (fact: MemoryFact) => void
  onOpenBot: (botId: string, name: string) => void
  onOpenRemoved: () => void
  onConnect: (page: MemoryBrowsePage) => void
}

export function SearchField({ value, onChange, inputRef }: { value: string; onChange: (next: string) => void; inputRef: RefObject<SearchInput | null> }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: theme.muted }}>
      <SearchIcon color={theme.mutedForeground} size={16} />
      <TextInput
        ref={inputRef}
        testID="memory-search"
        value={value}
        onChangeText={onChange}
        placeholder="Search memory"
        placeholderTextColor={theme.mutedForeground}
        accessibilityLabel="Search memory"
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
        maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.composerInput}
        style={{ flex: 1, paddingVertical: 10, fontFamily: 'Inter_400Regular', ...MOBILE_SCALE.details.input, color: theme.foreground }}
      />
    </View>
  )
}

function NotConnected({ page, busy, onConnect }: { page: MemoryBrowsePage; busy: boolean; onConnect: () => void }) {
  const theme = useTheme()
  if (page.notConnected.length === 0) return null
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline }}>
      <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { flex: 1, minWidth: 200 }]}>
        {notConnectedLine(page.notConnected.map(bot => bot.name))}
      </AppText>
      <Pressable testID="memory-connect" disabled={busy} onPress={onConnect} accessibilityRole="button" style={{ minHeight: 40, paddingHorizontal: 16, justifyContent: 'center', borderRadius: radius.md, backgroundColor: theme.foreground, opacity: busy ? 0.5 : 1 }}>
        <AppText variant="name" color={theme.background} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
          {busy ? 'Connecting…' : 'Connect'}
        </AppText>
      </Pressable>
    </View>
  )
}

export function MemoryMain({ bots, now, busy, searchRef, onOpenFact, onOpenBot, onOpenRemoved, onConnect }: MemoryMainProps) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const words = query.trim()
  const { page, facts, error, more } = useMemoryList(words ? { view: 'kept', query: words, limit: 50 } : { view: 'shared', limit: 50 })
  const botOf = (botId: string) => bots.find(bot => bot.id === botId)

  useEffect(() => {
    if (page) rememberPage(page, facts)
  }, [page, facts])

  const search = <SearchField key="search" value={query} onChange={setQuery} inputRef={searchRef} />
  if (!page) return [search, <MemoryStatus key="status" error={error} />]

  if (words) {
    const shared = facts.filter(fact => fact.scope === 'shared')
    const own = facts.filter(fact => fact.scope === 'bot')
    return [
      search,
      <MemoryNote key="matches">{matchLine(facts.length, page.nextCursor !== null)}</MemoryNote>,
      shared.length > 0 && (
        <MemoryGroup key="shared" title={MEMORY_TITLES.shared} count={shared.length}>
          {shared.map(fact => <FactRow key={fact.id} fact={fact} now={now} onOpen={() => onOpenFact(fact)} />)}
        </MemoryGroup>
      ),
      own.length > 0 && (
        <MemoryGroup key="own" title={MEMORY_TITLES.oneBot} count={own.length}>
          {own.map(fact => <FactRow key={fact.id} fact={fact} now={now} bot={botOf(fact.botId)} onOpen={() => onOpenFact(fact)} />)}
        </MemoryGroup>
      ),
      page.nextCursor && (
        <MemoryGroup key="more" title="">
          {[<MoreRow key="more" label="Show more" onPress={() => void more()} />]}
        </MemoryGroup>
      )
    ]
  }

  const { owners, total } = factOwners(page.bots)
  const { shown, hidden } = sharedShown(facts, page.shared, expanded)
  const notice = <NotConnected key="connect" page={page} busy={busy} onConnect={() => onConnect(page)} />
  const removed = page.removed > 0 && <RemovedLink key="removed" count={page.removed} onOpen={onOpenRemoved} />
  if (page.shared === 0 && owners.length === 0)
    return [
      notice,
      <View key="empty" style={{ alignItems: 'center', gap: 6, paddingVertical: 40, paddingHorizontal: 12 }}>
        <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
          {MEMORY_TITLES.empty}
        </AppText>
        <MemoryNote>{MEMORY_TITLES.emptyHint}</MemoryNote>
      </View>,
      removed
    ]
  return [
    search,
    notice,
    error ? <MemoryNote key="error" tone="error">{error}</MemoryNote> : null,
    page.shared > 0 && (
      <MemoryGroup key="shared" title={MEMORY_TITLES.shared} count={page.shared}>
        {[
          ...shown.map(fact => <FactRow key={fact.id} fact={fact} now={now} onOpen={() => onOpenFact(fact)} />),
          hidden > 0 && <MoreRow key="more" hidden={hidden} onPress={() => (expanded ? void more() : setExpanded(true))} />
        ]}
      </MemoryGroup>
    ),
    owners.length > 0 && (
      <MemoryGroup key="owners" title={MEMORY_TITLES.oneBot} count={total}>
        {owners.map(owner => <BotRow key={owner.botId} owner={owner} bot={botOf(owner.botId)} onOpen={() => onOpenBot(owner.botId, owner.name)} />)}
      </MemoryGroup>
    ),
    removed
  ]
}
