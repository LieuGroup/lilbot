import { useBotStore } from '../bots/bot-store'

/** Placeholder: the Library tab is designed under #14. */
export function LibraryTab({ botId }: { botId: string }) {
  const name = useBotStore(state => state.bots.find(bot => bot.id === botId)?.name ?? 'This bot')
  return (
    <div className="px-3 pt-1 pb-4">
      <p className="rounded-lg bg-card px-3 py-2.5 text-[13px]/[18px] text-muted-foreground ring-1 ring-hairline">Pages, media and files {name} gives you will show here.</p>
    </div>
  )
}
