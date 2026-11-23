import { describe, expect, test } from 'bun:test'
import { type BotActionsSocket, createBotActions } from '../../ios/src/bots/actions-core'
import { buildRosterListItems, splitNewBotHeaderKey } from '../../ios/src/bots/roster-list'
import { type BotRosterSocket, createBotStore } from '../../ios/src/bots/store-core'
import { runningGroups } from '../../shared/client/bots/running-groups'
import { testBot as bot } from '../web/test-bot'

describe('Round 4 iOS Roster store guards, action error reporting, and 200-bot virtualization', () => {
  test('useBotStore has no dead connected flag and ignores stale out-of-order responses and errors', async () => {
    let resolveFirst!: (bots: ReturnType<typeof bot>[]) => void
    let resolveSecond!: (bots: ReturnType<typeof bot>[]) => void
    let rejectThird!: (err: Error) => void
    let callIdx = 0
    const socket: BotRosterSocket = {
      call: ((method: 'bots.list' | 'sections.list') => {
        if (method === 'sections.list') return Promise.resolve([])
        callIdx += 1
        if (callIdx === 1) return new Promise(r => (resolveFirst = r))
        if (callIdx === 2) return new Promise(r => (resolveSecond = r))
        if (callIdx === 3) return new Promise((_, rej) => (rejectThird = rej))
        return Promise.resolve([bot('newest')])
      }) as unknown as BotRosterSocket['call']
    }
    const store = createBotStore(() => socket)
    expect('connected' in store.getState()).toBe(false)

    const p1 = store.getState().load()
    const p2 = store.getState().load()
    resolveSecond([bot('fresh')])
    await p2
    expect(store.getState().bots.map(b => b.id)).toEqual(['fresh'])
    resolveFirst([bot('stale')])
    await p1
    expect(store.getState().bots.map(b => b.id)).toEqual(['fresh'])

    const p3 = store.getState().load()
    const p4 = store.getState().load()
    await p4
    expect(store.getState().bots.map(b => b.id)).toEqual(['newest'])
    rejectThird(new Error('stale failure'))
    await p3
    expect(store.getState().error).toBe('')
    expect(store.getState().bots.map(b => b.id)).toEqual(['newest'])
  })

  test('bot actions report disconnect and server errors cleanly without throwing on inline actions', async () => {
    let lastError = ''
    let reloads = 0
    const disconnected = createBotActions({
      getSocket: () => null,
      reload: async () => {
        reloads += 1
      },
      upsert: () => {},
      setError: m => {
        lastError = m
      }
    })
    await disconnected.setBotPrefs({ botId: 'a', pinned: true })
    expect(lastError).toBe('Not connected to a LilBot server.')
    expect(reloads).toBe(0)
    await expect(disconnected.deleteBot('a', { files: 'archive', privateMemories: 'forget' })).rejects.toThrow('Not connected')

    const failingSocket: BotActionsSocket = {
      call: (async () => {
        throw new Error('Permission denied')
      }) as BotActionsSocket['call']
    }
    const failing = createBotActions({
      getSocket: () => failingSocket,
      reload: async () => {
        reloads += 1
      },
      upsert: () => {},
      setError: m => {
        lastError = m
      }
    })
    await failing.setBotUnread('a', true)
    expect(lastError).toBe('Permission denied')
    await failing.makeBotPrimary('a')
    expect(lastError).toBe('Permission denied')
    await expect(failing.moveToNewSection('a', 'Ops')).rejects.toThrow('Permission denied')
    expect(reloads).toBe(0)
  })

  test('virtualized list flattening handles 200 bots quickly with split inline header key and leader-first runningGroups', () => {
    const sections = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `Section ${i}` }))
    const bots = Array.from({ length: 200 }, (_, i) =>
      bot(`b${i}`, {
        isPrimary: i === 0,
        prefs: { pinned: i > 0 && i < 4, pinnedAt: i * 10, sectionId: i >= 4 && i < 180 ? `s${i % 5}` : null, hidden: i >= 190 }
      })
    )
    const t0 = performance.now()
    const items = buildRosterListItems({ bots, sections, loaded: true, connected: true, error: '', query: '', selectedId: null, unassignedOpen: false, hiddenOpen: false })
    const elapsedMs = performance.now() - t0
    expect(elapsedMs).toBeLessThan(50)
    expect(items[0]?.kind).toBe('tiles')
    expect(items.filter(i => i.kind === 'section-header')).toHaveLength(5)
    expect(items.filter(i => i.kind === 'bot')).toHaveLength(176)
    expect(items.filter(i => i.kind === 'group-toggle').map(i => i.name)).toEqual(['Unassigned', 'Hidden'])
    expect(splitNewBotHeaderKey(items)).toBe('sec:s0')
    expect(
      splitNewBotHeaderKey(
        buildRosterListItems({ bots: [bot('only')], sections: [], loaded: true, connected: true, error: '', query: '', selectedId: null, unassignedOpen: false, hiddenOpen: false })
      )
    ).toBeNull()

    const member = { ...bot('m1'), groups: [{ id: 'g1', purpose: 'Launch checklist', round: 2, roundCap: 6, leading: false }] }
    const leader = { ...bot('l1'), groups: [{ id: 'g1', purpose: 'Launch checklist', round: 2, roundCap: 6, leading: true }] }
    expect(runningGroups([member, leader])[0]?.bots.map(b => b.id)).toEqual(['l1', 'm1'])
  })
})
