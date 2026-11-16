/** The roster's foot: who is using the app, or that the app has lost its server. LilBot has one
 *  user and no account data yet, so the name is fixed. Settings join it later (#37). */
export function RosterFooter({ connected }: { connected: boolean }) {
  return (
    <div className="flex flex-none items-center justify-between pt-2.5 pr-2.5 pb-[max(12px,env(safe-area-inset-bottom))] pl-4">
      {connected ? (
        <div className="flex h-7 items-center gap-2">
          <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-foreground/8 text-[11px]/[14px] font-semibold">
            O
          </span>
          <span className="text-[13px]/[18px] font-medium">Oscar</span>
        </div>
      ) : (
        <div role="status" className="flex h-7 items-center gap-2 text-[13px]/[18px] text-muted-foreground">
          <span aria-hidden="true" className="flex size-6 items-center justify-center">
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
          </span>
          <span>
            <span className="font-medium text-foreground">Offline</span> · reconnecting
          </span>
        </div>
      )}
    </div>
  )
}
