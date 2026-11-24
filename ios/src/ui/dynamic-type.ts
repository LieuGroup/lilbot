/** Pure Dynamic Type layout rules so default (fontScale 1.0) stays untouched while ordinary larger sizes
 *  (xxxLarge) and accessibility sizes (AX1-AX5) reflow cleanly without 3-letter truncation or clipping.
 *  Zero React Native imports so unit tests verify every threshold on Linux. */

export const DYNAMIC_TYPE_CAPS = {
  /** Caps compact pinned grid labels (~24 pt at AX sizes) while letting Large-xxxLarge scale naturally. */
  pinnedLabel: 1.6,
  /** Caps section headers (~24 pt) so collapsed/expanded headers stay legible beside inline actions. */
  sectionHeader: 1.6,
  /** Caps roster row names (~34 pt at AX5) so names stay huge and readable without crowding 2-line previews. */
  rowName: 2.0,
  /** Caps roster row previews (~27 pt at AX5) so 2-line AX5 previews keep multiple readable words. */
  rowPreview: 1.8,
  /** Caps right-aligned row timestamps (~21 pt) so bot names keep room on narrow screens. */
  rowTime: 1.6,
  /** Caps chat navigation header titles (~21.6 pt) so bot names fit inside the 44 pt iOS bar at AX5. */
  headerTitle: 1.35,
  /** Caps composer model pill (~19.5 pt) so model + effort remain readable at AX5 instead of "Default...". */
  modelPill: 1.5,
  /** Caps composer input (~36 pt) paired with a scaled maxHeight so multi-word placeholders stay visible. */
  composerInput: 2.0
} as const

/** Pinned tile columns: keeps 2/3-up at default size, drops 3-up to 2-up at xxxLarge (>= 1.35),
 *  and switches to 1 column at AX2+ (>= 2.0) so names never collapse to 3 characters. */
export function pinnedTileColumns(botCount: number, fontScale: number): 1 | 2 | 3 {
  if (fontScale >= 2.0) return 1
  if (fontScale >= 1.35) return 2
  return botCount > 2 ? 3 : 2
}

/** Roster row name & preview line cap: stays single-line across ordinary sizes (Large-xxxLarge)
 *  and expands to 2 lines at accessibility sizes (AX1+, >= 1.6) so names and previews remain readable. */
export function rosterRowTextLines(fontScale: number): 1 | 2 {
  return fontScale >= 1.6 ? 2 : 1
}

/** Scales roster row avatars modestly with Dynamic Type (1.0x at default, capped at 1.35x)
 *  so avatars stay proportional without crowding row text at AX5. */
export function scaledRowAvatarSize(baseSize: number, fontScale: number): number {
  const factor = Math.min(Math.max(fontScale, 1), 1.35)
  return Math.round(baseSize * factor)
}

/** Scales composer TextInput maxHeight with Dynamic Type so AX5 placeholders and typed lines do not clip. */
export function composerInputMaxHeight(fontScale: number): number {
  const factor = Math.min(Math.max(fontScale, 1), 2.0)
  return Math.round(132 * factor)
}
