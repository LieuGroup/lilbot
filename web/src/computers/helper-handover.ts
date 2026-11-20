/** The page's own hand-over to an opened helper on this computer (docs/computers.md). The code goes only in the POST
 *  body, never in a URL, a log or an error message. */

/** Chrome's Local Network Access needs this on both calls from an HTTPS page; lib.dom does not know it yet. */
const LOOPBACK = { targetAddressSpace: 'loopback' } as RequestInit

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })

/** Ask the helper about once a second until it is open and waiting, then give it the code once. Returns when the
 *  helper took it or answered that it cannot (used, refused); a rejected fetch just means no helper yet. */
export async function handOver(handoverUrl: string, code: string, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      const hello = await fetch(`${handoverUrl}/v1/hello`, { ...LOOPBACK, signal })
      const body = hello.ok ? ((await hello.json()) as { app?: string; state?: string }) : null
      if (body?.app === 'lilbot-helper') {
        if (body.state !== 'waiting') return
        const answer = await fetch(`${handoverUrl}/v1/handover`, {
          ...LOOPBACK,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
          signal
        })
        if (answer.ok || answer.status === 410 || answer.status === 422) return
      }
    } catch {
      // No helper open yet, or the browser blocked the request: the fallbacks cover it.
    }
    await pause(1000, signal)
  }
}
