import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  INITIAL_PULL_TO_SEARCH_STATE,
  pullToSearchOnDragEnd,
  pullToSearchOnDragStart,
  pullToSearchOnMomentumEnd,
  pullToSearchOnMomentumStart,
  pullToSearchOnScroll,
  resetPullToSearchState
} from '../../ios/src/bots/roster-list'

describe('Round 4 iOS Roster pull-to-search with iPad adjustedContentInset', () => {
  test('ignores iPad automatic top inset when scrolling down from rest and opens only on a real pull past rest', () => {
    // iPadOS 26: Fabric sends contentInset.top = 0 while adjustedContentInset.top = 96 -> resting contentOffset.y = -96.
    let s = INITIAL_PULL_TO_SEARCH_STATE
    let r = pullToSearchOnScroll(s, { contentOffsetY: 0, contentInsetTop: 0 })
    s = r.state
    expect(r.pullDistance).toBe(0)
    r = pullToSearchOnScroll(s, { contentOffsetY: -96, contentInsetTop: 0 })
    s = r.state
    expect(r.pullDistance).toBe(0)
    expect(s.restTopY).toBe(-96)

    // Dragging upward to scroll down from rest on iPad (-96 -> -95 -> -80 -> 0 -> +120) must NEVER open Search.
    s = pullToSearchOnDragStart(s, -96)
    for (const y of [-95, -80, 0, 120]) {
      r = pullToSearchOnScroll(s, { contentOffsetY: y, contentInsetTop: 0 })
      s = r.state
      expect(r.pullDistance).toBe(0)
    }
    s = pullToSearchOnDragEnd(s)
    s = pullToSearchOnMomentumStart(s)
    s = pullToSearchOnMomentumEnd(s, 200)

    // Scrolling back up from +200 to rest (-96) yields 0; continuing 56 pt past rest (-152) yields 56.
    s = pullToSearchOnDragStart(s, 200)
    expect(pullToSearchOnScroll(s, { contentOffsetY: -96, contentInsetTop: 0 }).pullDistance).toBe(0)
    expect(pullToSearchOnScroll(s, { contentOffsetY: -152, contentInsetTop: 0 }).pullDistance).toBe(56)

    // Releasing mid-bounce (-130) must not corrupt restTopY during bounce-back frames.
    s = pullToSearchOnDragEnd(s)
    expect(pullToSearchOnScroll(s, { contentOffsetY: -130, contentInsetTop: 0 }).pullDistance).toBe(0)
    expect(s.restTopY).toBe(-96)
  })

  test('resets cleanly on layout/rotation changes and works immediately on first iPhone drag', () => {
    // Layout / rotation reset clears restTopY; scrolling up from mid-list (+150 -> -96) must not false-trigger,
    // and settling at -96 re-learns restTopY so the next pull (-96 -> -152) opens Search.
    let s = resetPullToSearchState()
    s = pullToSearchOnDragStart(s, 150)
    expect(pullToSearchOnScroll(s, { contentOffsetY: -96, contentInsetTop: 0 }).pullDistance).toBe(0)
    s = pullToSearchOnMomentumEnd(pullToSearchOnDragEnd(s), -96)
    expect(s.restTopY).toBe(-96)
    s = pullToSearchOnDragStart(s, -96)
    expect(pullToSearchOnScroll(s, { contentOffsetY: -152, contentInsetTop: 0 }).pullDistance).toBe(56)

    // iPhone (y = 0, no pre-drag onScroll): first pull down (0 -> -56) works immediately; scrolling down yields 0.
    const phone = pullToSearchOnDragStart(INITIAL_PULL_TO_SEARCH_STATE, 0)
    expect(pullToSearchOnScroll(phone, { contentOffsetY: 20, contentInsetTop: 0 }).pullDistance).toBe(0)
    expect(pullToSearchOnScroll(phone, { contentOffsetY: -56, contentInsetTop: 0 }).pullDistance).toBe(56)

    // Also respects explicit contentInsetTop when non-zero.
    const inset = pullToSearchOnDragStart(INITIAL_PULL_TO_SEARCH_STATE, -40)
    expect(pullToSearchOnScroll(inset, { contentOffsetY: -96, contentInsetTop: 40 }).pullDistance).toBe(56)
  })

  test('wires layout reset and all scroll/drag/momentum handlers from Roster into usePullToSearch', () => {
    const rosterSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/roster.tsx'), 'utf8')
    for (const wired of [
      'usePullToSearch(',
      'onLayout={pullHandlers.onLayout}',
      'onScroll={pullHandlers.onScroll}',
      'onScrollBeginDrag={pullHandlers.onScrollBeginDrag}',
      'onScrollEndDrag={pullHandlers.onScrollEndDrag}',
      'onMomentumScrollBegin={pullHandlers.onMomentumScrollBegin}',
      'onMomentumScrollEnd={pullHandlers.onMomentumScrollEnd}'
    ]) {
      expect(rosterSource).toContain(wired)
    }

    const hookSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/use-pull-to-search.ts'), 'utf8')
    for (const wired of [
      'resetPullToSearchState()',
      'pullToSearchOnScroll(',
      'pullToSearchOnDragStart(',
      'pullToSearchOnDragEnd(',
      'pullToSearchOnMomentumStart(',
      'pullToSearchOnMomentumEnd('
    ]) {
      expect(hookSource).toContain(wired)
    }
  })
})
