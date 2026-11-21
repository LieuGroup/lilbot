/** Waits on the condition a test needs, not on a fixed sleep a loaded machine can overrun. */
export async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out')
    await Bun.sleep(5)
  }
}
