/** Pure pointer-down / click state transitions for external popover triggers (TurnActions and ContextMeter).
 *  Capturing pre-dismiss state at pointer-down avoids wall-clock windows that break hover-to-pin and slow clicks. */
export interface TriggerState {
  open: boolean
  pinned: boolean
}

/** Next open state for a click-only trigger (TurnActions): closes if it was open at pointer-down, else opens. */
export function toggleOnClick(open: boolean, down: { open: boolean } | null): boolean {
  return !(down ? down.open : open)
}

/** Next state for a hover+click trigger (ContextMeter): clicking a hover-opened pill pins it open; clicking an already-pinned pill closes it. */
export function contextMeterOnClick(current: TriggerState, down: TriggerState | null): TriggerState {
  const state = down ?? current
  if (state.open && state.pinned) return { open: false, pinned: false }
  return { open: true, pinned: true }
}
