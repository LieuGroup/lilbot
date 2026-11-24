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
