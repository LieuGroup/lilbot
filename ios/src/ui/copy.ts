/** Copies text directly to the iOS clipboard via `expo-clipboard`. Never falls back to `Share.share`,
 *  which would display secret webhook addresses or pairing codes in plain text inside the share sheet preview. */
export async function copyText(text: string): Promise<'copied' | 'failed'> {
  try {
    const mod = (await import('expo-clipboard' as string)) as { setStringAsync?: (value: string) => Promise<void> }
    if (typeof mod.setStringAsync === 'function') {
      await mod.setStringAsync(text)
      return 'copied'
    }
  } catch {
    return 'failed'
  }
  return 'failed'
}
