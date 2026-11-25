/** Human-friendly elapsed duration formatting shared by web and iOS ("just now", "4 min", "2 h"). Pure. */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h`
}
