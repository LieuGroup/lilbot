/** Which user turns pin the conversation to the top. The scroller jumps to any pin it did not see
 *  arrive, so only turns that arrive while the list is open may be pins. Pure functions only. */

/** The transcript as the list last loaded it: which load (`ChatView.load`) and how many items it held. */
export interface LoadedTranscript {
  load: number
  count: number
}

export const loadedTranscript = (items: readonly unknown[], load: number): LoadedTranscript => ({ load, count: items.length })

/** Opening or reopening the chat loads the transcript again (a new `load`); live events keep it.
 *  The first message sent into an empty chat arrives live, so it is a pin. */
export function updateLoaded(loaded: LoadedTranscript, items: readonly unknown[], load: number): LoadedTranscript {
  return load !== loaded.load ? loadedTranscript(items, load) : loaded
}

export const isScrollAnchor = (loaded: LoadedTranscript, index: number, kind: string) => kind === 'user' && index >= loaded.count
