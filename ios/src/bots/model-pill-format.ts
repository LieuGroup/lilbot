/** Pure formatting for the composer model pill so narrow Folded Duo widths shorten long model
 *  identifiers cleanly without amputating the reasoning effort suffix ("· High", "· Default"). */

/** Strips redundant provider slash prefixes (e.g. "anthropic/claude-opus-5-5" -> "claude-opus-5-5")
 *  while preserving plain labels like "Default model" or "Choose a model". */
export function compactModelLabel(label: string): string {
  const trimmed = label.trim()
  const slash = trimmed.lastIndexOf('/')
  if (slash > 0 && slash < trimmed.length - 1) return trimmed.slice(slash + 1)
  return trimmed
}

export interface ModelPillSegments {
  model: string
  effortSuffix: string | null
  accessibilityLabel: string
}

/** Splits the model pill into a shrinkable model segment and a non-shrinking effort suffix
 *  so effort remains readable on narrow widths when a long model name ellipsizes. */
export function modelPillSegments(view: { label: string; effort: string | null; differs: boolean }): ModelPillSegments {
  const model = compactModelLabel(view.label)
  const effortSuffix = view.effort ? ` · ${view.effort}` : null
  const spoken = view.effort ? `${model}, ${view.effort}` : model
  return {
    model,
    effortSuffix,
    accessibilityLabel: `Model: ${spoken}${view.differs ? ', the engine sends another level' : ''}`
  }
}
