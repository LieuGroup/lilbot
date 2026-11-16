/** Which user turns pin the conversation to the top. The scroller jumps to any pin it did not see
 *  arrive, so only turns that arrive while the list is open may be pins. Pure functions only. */

/** The transcript as the list first saw it: its first item and how many items it held. */
export interface LoadedTranscript {
  first: unknown
  count: number
}

export const loadedTranscript = (items: readonly unknown[]): LoadedTranscript => ({ first: items[0], count: items.length })

/** A snapshot (opening or reopening the chat) brings new item objects, while live events keep the
 *  earlier ones, so a new first item means the whole transcript was loaded again. An empty list
 *  stays as it is: the first message sent into it arrives live. */
export function updateLoaded(loaded: LoadedTranscript, items: readonly unknown[]): LoadedTranscript {
  return loaded.first !== undefined && items[0] !== loaded.first ? loadedTranscript(items) : loaded
}

export const isScrollAnchor = (loaded: LoadedTranscript, index: number, kind: string) => kind === 'user' && index >= loaded.count
