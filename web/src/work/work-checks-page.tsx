/** "Checks" tab on the Work board: default check level per kind and per-bot overrides (Paper artboard 20, frame 7). */
import { Fragment, useState } from 'react'
import { Notice } from '@/ui/notice'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/ui/select'
import type { WorkKind } from '../../../shared/work-check-schema'
import { messageOf } from '../app/lilbot-socket'
import { useBotStore } from '../bots/bot-store'
import { ThreadAvatar } from '../threads/thread-avatar'
import { AddBotLevelDialog } from './add-bot-level-dialog'
import { kindLabel, kindShortLabel, levelChoiceLabel } from './work-lines'
import { setWorkLevel, useWorkLevels } from './work-store'

const LEVELS = [0, 1, 2, 3] as const

function levelClass(level: number) {
  if (level === 0) return 'text-muted-foreground'
  if (level === 3) return 'font-semibold text-foreground'
  if (level === 2) return 'font-medium text-foreground'
  return 'text-foreground'
}

export default function WorkChecksPage() {
  const { levels, error } = useWorkLevels()
  const bots = useBotStore(state => state.bots)
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set())
  const [actionError, setActionError] = useState('')
  const [adding, setAdding] = useState(false)

  if (!levels) {
    return <div className="mx-auto max-w-[540px] px-6 py-5 text-[13px] text-muted-foreground">{error ? <Notice tone="error">{error}</Notice> : 'Loading check levels...'}</div>
  }

  const overrides = levels.kinds.flatMap(entry =>
    Object.entries(entry.bots).map(([botId, level]) => ({
      botId,
      botName: bots.find(b => b.id === botId)?.name ?? botId,
      kind: entry.kind,
      level,
      defaultLevel: entry.level
    }))
  )

  async function save(kind: WorkKind, level: number | null, botId?: string) {
    const key = `${kind}:${botId ?? ''}`
    if (savingKeys.has(key)) return
    setSavingKeys(prev => new Set(prev).add(key))
    setActionError('')
    try {
      await setWorkLevel(kind, level, botId)
    } catch (failure) {
      setActionError(messageOf(failure))
    } finally {
      setSavingKeys(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  return (
    <div className="mx-auto flex max-w-[540px] flex-col gap-3 px-5 py-5 md:px-6">
      {(error || actionError) && <Notice tone="error">{actionError || error}</Notice>}
      <h2 className="text-xs/4 text-muted-foreground">Who checks each kind of work</h2>
      <div className="flex flex-col rounded-xl bg-background">
        {levels.kinds.map((entry, index) => (
          <Fragment key={entry.kind}>
            {index > 0 && <div className="h-px bg-foreground/6" />}
            <div className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className="text-[13px]/[18px] text-foreground">{kindLabel(entry.kind)}</span>
              <Select
                value={String(entry.level)}
                disabled={savingKeys.has(`${entry.kind}:`)}
                onValueChange={v => {
                  if (!v) return
                  void save(entry.kind, v === 'reset' ? null : Number(v))
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={`Check level for ${kindLabel(entry.kind)}`}
                  className={`h-7 border-transparent bg-transparent pr-1.5 pl-2 text-[13px]/[18px] hover:bg-foreground/4 dark:bg-transparent ${levelClass(entry.level)}`}
                >
                  <SelectValue>{levelChoiceLabel(entry.level)}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {LEVELS.map(level => (
                    <SelectItem key={level} value={String(level)}>
                      {levelChoiceLabel(level)}
                    </SelectItem>
                  ))}
                  {entry.level !== entry.builtIn && (
                    <>
                      <SelectSeparator />
                      <SelectItem value="reset">Built-in ({levelChoiceLabel(entry.builtIn)})</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </Fragment>
        ))}
      </div>
      <p className="text-xs/4 text-muted-foreground">A bot may check more than this, never less.</p>

      <div className="flex items-center justify-between pt-2">
        <h2 className="text-xs/4 text-muted-foreground">Different for one bot</h2>
        {bots.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md px-1.5 py-0.5 text-xs/4 font-medium text-foreground outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Add
          </button>
        )}
      </div>

      {overrides.length === 0 ? (
        <p className="text-xs/4 text-muted-foreground">All bots follow the levels above.</p>
      ) : (
        <div className="flex flex-col rounded-xl bg-background">
          {overrides.map((entry, index) => (
            <Fragment key={`${entry.botId}:${entry.kind}`}>
              {index > 0 && <div className="h-px bg-foreground/6" />}
              <div className="flex items-center gap-2 px-3 py-1.5">
                <ThreadAvatar id={entry.botId} name={entry.botName} size={16} />
                <span className="min-w-0 flex-1 truncate text-[13px]/[18px] text-foreground">
                  {entry.botName} · {kindShortLabel(entry.kind)}
                </span>
                <Select
                  value={String(entry.level)}
                  disabled={savingKeys.has(`${entry.kind}:${entry.botId}`)}
                  onValueChange={v => {
                    if (!v) return
                    void save(entry.kind, v === 'reset' ? null : Number(v), entry.botId)
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={`Check level for ${entry.botName} ${kindShortLabel(entry.kind)}`}
                    className={`h-7 border-transparent bg-transparent pr-1.5 pl-2 text-[13px]/[18px] hover:bg-foreground/4 dark:bg-transparent ${levelClass(entry.level)}`}
                  >
                    <SelectValue>{levelChoiceLabel(entry.level)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    {LEVELS.map(level => (
                      <SelectItem key={level} value={String(level)}>
                        {levelChoiceLabel(level)}
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem value="reset">Use default ({levelChoiceLabel(entry.defaultLevel)})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Fragment>
          ))}
        </div>
      )}

      {adding && (
        <AddBotLevelDialog
          bots={bots}
          onSave={async (botId, kind, level) => {
            await setWorkLevel(kind, level, botId)
            setAdding(false)
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
