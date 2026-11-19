/** Which user turns pin the conversation to the top. The scroller jumps to any pin it did not see
 *  arrive, so only turns that arrive while the list is open may be pins. Pure functions only.
 *  Rows are counted by position in the conversation (`ChatView.first` plus the index), so earlier
 *  parts of the history loading above never turn old turns into pins. */

/** The transcript as the list last loaded it: which load (`ChatView.load`) and the position just
 *  after its last item. */
export interface LoadedTranscript {
  load: number
  end: number
}

export const loadedTranscript = (first: number, count: number, load: number): LoadedTranscript => ({ load, end: first + count })

/** Opening or reopening the chat loads the transcript again (a new `load`); live events and
 *  earlier parts keep it. The first message sent into an empty chat arrives live, so it is a pin. */
export function updateLoaded(loaded: LoadedTranscript, first: number, count: number, load: number): LoadedTranscript {
  return load !== loaded.load ? loadedTranscript(first, count, load) : loaded
}

export const isScrollAnchor = (loaded: LoadedTranscript, position: number, kind: string) => kind === 'user' && position >= loaded.end
