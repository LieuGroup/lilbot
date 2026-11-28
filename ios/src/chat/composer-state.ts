/** Pure composer visibility and send/stop rules for the Round 4 resting-vs-typing composer.
 *  Zero React Native imports so unit tests verify every transition on Linux. */

/** Single constant for the resting composer placeholder (`build-spec.md` §9A: "" vs "Message"). */
export const COMPOSER_REST_PLACEHOLDER = 'Message'

export interface ComposerExpandInput {
  focused: boolean
  draft: string
  stagedCount: number
  screenReaderEnabled: boolean
}

/** Resting composer stays a single quiet pill while reading; expands to the typing toolbar
 *  (model pill + context meter) when focused, non-empty, holding attachments, or under VoiceOver. */
export function isComposerExpanded(input: ComposerExpandInput): boolean {
  return input.focused || input.draft.length > 0 || input.stagedCount > 0 || input.screenReaderEnabled
}

export interface ComposerActionInput {
  ready: boolean
  running: boolean
  draft: string
  readyAttachments: number
  uploadingAttachments: boolean
}

export interface ComposerActionState {
  hasPayload: boolean
  canSend: boolean
  stopping: boolean
}

/** Resolves Send vs Stop vs disabled state, allowing attachment-only messages and blocking send while uploads run. */
export function composerActionState(input: ComposerActionInput): ComposerActionState {
  const hasPayload = input.draft.trim().length > 0 || input.readyAttachments > 0
  const canSend = input.ready && hasPayload && !input.uploadingAttachments
  const stopping = input.running && !hasPayload && !input.uploadingAttachments
  return { hasPayload, canSend, stopping }
}

const COMPACT_LANDSCAPE_MAX_HEIGHT = 500

export interface ComposerChromeSpacing {
  compactLandscape: boolean
  outerPaddingTop: number
  outerPaddingBottom: number
  cardPaddingTop: number
  cardPaddingBottom: number
  toolbarMarginTop: number
}

/** Tightens vertical composer chrome when the software keyboard is open on a short landscape viewport
 *  (<= 500 pt, e.g. Folded Duo 678x466 or ordinary iPhone landscape) so both the composer and the
 *  latest message stay visible without changing portrait spacing. */
export function composerChromeSpacing(input: {
  viewportHeight: number
  expanded: boolean
  keyboardOpen: boolean
  bottomInset: number
}): ComposerChromeSpacing {
  const compactLandscape = input.keyboardOpen && input.viewportHeight > 0 && input.viewportHeight <= COMPACT_LANDSCAPE_MAX_HEIGHT
  if (compactLandscape) {
    return {
      compactLandscape: true,
      outerPaddingTop: 2,
      outerPaddingBottom: 6,
      cardPaddingTop: input.expanded ? 8 : 7,
      cardPaddingBottom: input.expanded ? 6 : 7,
      toolbarMarginTop: 6
    }
  }
  return {
    compactLandscape: false,
    outerPaddingTop: 4,
    outerPaddingBottom: input.keyboardOpen ? 12 : Math.max(12, input.bottomInset),
    cardPaddingTop: input.expanded ? 12 : 9,
    cardPaddingBottom: input.expanded ? 10 : 9,
    toolbarMarginTop: 10
  }
}
