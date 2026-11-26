/** Opening a service's sign-in page from a click (#314), in a way pop-up blockers allow and that gives the page no hold on
 *  LilBot. The tab is opened synchronously inside the click (a `window.open` after an await is blocked by Safari, and
 *  by any browser once the click's activation has gone stale), before the link is fetched. Then its opener is cut and
 *  the tab navigates itself through a no-referrer meta refresh: a navigation started by LilBot's own page would carry
 *  LilBot's referrer policy, so the tab's own document starts it instead. The link goes into that tab and nowhere else. */

export interface SignInTab {
  /** Sends the tab to the sign-in page. */
  go(url: string): void
  /** Closes the blank tab when the link could not be fetched. */
  close(): void
}

/** The blank tab, or null when the browser blocked it. Call this synchronously from the click handler. */
export function openBlankTab(open: typeof window.open = window.open.bind(window)): SignInTab | null {
  const tab = open('', '_blank')
  if (!tab) return null
  try {
    tab.opener = null
  } catch {}
  return {
    go(url) {
      const doc = tab.document
      const policy = doc.createElement('meta')
      policy.name = 'referrer'
      policy.content = 'no-referrer'
      const refresh = doc.createElement('meta')
      refresh.httpEquiv = 'refresh'
      refresh.content = `0;url=${url}`
      doc.head.append(policy, refresh)
    },
    close() {
      tab.close()
    }
  }
}
