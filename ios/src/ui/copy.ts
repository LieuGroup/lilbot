/** Copies text to the iOS clipboard when expo-clipboard is installed, falling back to the native share sheet. */
import { Share } from 'react-native'

export async function copyText(text: string): Promise<'copied' | 'shared' | 'failed'> {
  try {
    const mod = (await import('expo-clipboard' as string)) as { setStringAsync?: (value: string) => Promise<void> }
    if (typeof mod.setStringAsync === 'function') {
      await mod.setStringAsync(text)
      return 'copied'
    }
  } catch {
    // expo-clipboard not installed on this branch yet; fall back to native iOS share sheet.
  }
  try {
    await Share.share({ message: text })
    return 'shared'
  } catch {
    return 'failed'
  }
}
