import { expect, test } from 'bun:test'
import { openBlankTab } from '../../web/src/connections/sign-in-tab'

/** A tab as far as the helper touches it: an opener to cut, a document head to write into, and close. */
function fakeTab() {
  const head: { name?: string; content?: string; httpEquiv?: string }[] = []
  const tab = {
    opener: {} as unknown,
    closed: false,
    close() {
      tab.closed = true
    },
    document: {
      createElement: () => ({}) as { name?: string; content?: string; httpEquiv?: string },
      head: { append: (...els: typeof head) => head.push(...els) }
    }
  }
  return { tab, head }
}

test('the blank tab opens with no address and no features, so it can open inside the click, and its opener is cut', () => {
  const { tab } = fakeTab()
  const calls: unknown[][] = []
  const open = (...args: unknown[]) => {
    calls.push(args)
    return tab
  }
  const opened = openBlankTab(open as never)
  expect(calls).toEqual([['', '_blank']])
  expect(opened).not.toBeNull()
  expect(tab.opener).toBeNull()
})

test('a blocked pop-up gives null, so the card does not claim to be waiting', () => {
  expect(openBlankTab((() => null) as never)).toBeNull()
})

test('the tab goes to the link by itself with no referrer, and the link is written only into that tab', () => {
  const { tab, head } = fakeTab()
  openBlankTab((() => tab) as never)!.go('https://login.example/authorize?state=s')
  expect(head).toEqual([
    { name: 'referrer', content: 'no-referrer' },
    { httpEquiv: 'refresh', content: '0;url=https://login.example/authorize?state=s' }
  ])
})

test('when the link cannot be fetched the blank tab is closed', () => {
  const { tab } = fakeTab()
  openBlankTab((() => tab) as never)!.close()
  expect(tab.closed).toBe(true)
})
