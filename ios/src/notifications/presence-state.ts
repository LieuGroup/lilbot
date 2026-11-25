/** Pure foreground-presence resolver so the server knows exactly which bot (if any) is on screen on this phone. */

export interface PresenceSnapshot {
  foreground: boolean
  botId: string | null
}

export interface PresenceInputs {
  appState: string
  botsTabActive: boolean
  splitMode: boolean
  chatFocused: boolean
  selectedId: string | null
}

/** Resolves whether this device is actively viewing a bot in the foreground.
 *  - Backgrounded or inactive app: `{ foreground: false, botId: null }`.
 *  - On Settings tab (not Bots tab): `{ foreground: true, botId: null }`.
 *  - On compact iPhone / Folded Duo: `selectedId` only while compact Chat is focused; `null` on Roster.
 *  - On split Unfolded Duo / iPad: `selectedId` whenever the Bots tab is active. */
export function resolveNotificationPresence(input: PresenceInputs): PresenceSnapshot {
  if (input.appState !== 'active') return { foreground: false, botId: null }
  if (!input.botsTabActive) return { foreground: true, botId: null }
  if (input.splitMode) return { foreground: true, botId: input.selectedId ?? null }
  return { foreground: true, botId: input.chatFocused ? (input.selectedId ?? null) : null }
}

export function samePresence(a: PresenceSnapshot | null, b: PresenceSnapshot): boolean {
  return a !== null && a.foreground === b.foreground && a.botId === b.botId
}
