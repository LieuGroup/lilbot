import { ChevronLeftIcon, ChevronRightIcon, FileIcon, FolderIcon } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Button } from '@/ui/button'
import type { WorkspaceEntry } from '../../../shared/library-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { formatBytes } from '../attachments/attachment-rules'
import { useBotStore } from '../bots/bot-store'
import { countLine, pathParts } from './library-lines'
import { folderPath, useFolderNavigation } from './open-folder'

const note = 'px-2 text-xs/4 text-muted-foreground'
const row = 'flex w-full items-center gap-2.5 px-3 py-[9px] text-left first:rounded-t-lg last:rounded-b-lg'

/** The bot's whole workspace folder, in place of the details panel (Paper "08 Library" panel 2): "‹ Library", the path
 *  (each part opens that folder), then folders first and files with their size. Read-only: only what the bot gave opens. */
export default function WorkspaceView({ botId, folder }: { botId: string; folder: string }) {
  const connected = useBotStore(state => state.connected)
  const { open, close } = useFolderNavigation()
  const path = folderPath(folder)
  const [entries, setEntries] = useState<WorkspaceEntry[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!connected) return
    let current = true
    setEntries(undefined)
    setError('')
    lilbot.call('library.workspace', { botId, path }).then(
      result => current && setEntries(result),
      failure => current && setError(messageOf(failure))
    )
    return () => {
      current = false
    }
  }, [botId, path, connected])
  const parts = pathParts(path)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center pt-[env(safe-area-inset-top)] pr-2.5 pl-2">
        <Button variant="ghost" className="h-auto gap-0.5 rounded-md py-[5px] pr-2 pl-1 text-[13px]/[18px] font-medium hover:bg-foreground/4" onClick={() => void close()}>
          <ChevronLeftIcon className="size-4" strokeWidth={1.75} />
          Library
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-1 pb-4">
        <nav aria-label="Folder" className="flex flex-wrap items-center gap-x-1.5 px-2 text-[13px]/[18px]">
          {parts.map((part, index) => (
            <Fragment key={part.path}>
              {index > 0 && <span className="text-foreground/40">/</span>}
              {index === parts.length - 1 ? (
                <span className="min-w-0 truncate font-medium" aria-current="page">
                  {part.name}
                </span>
              ) : (
                <button type="button" onClick={() => void open(part.path)} className="min-w-0 truncate text-muted-foreground hover:text-foreground">
                  {part.name}
                </button>
              )}
            </Fragment>
          ))}
        </nav>
        {!entries ? (
          <p className={error ? `${note} text-destructive` : note}>{error || 'Loading...'}</p>
        ) : (
          <>
            {entries.length > 0 && (
              <div className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">
                {entries.map((entry, index) => (
                  <Fragment key={entry.name}>
                    {index > 0 && <div className="h-px bg-foreground/6" />}
                    <Entry entry={entry} onOpen={() => void open(path ? `${path}/${entry.name}` : entry.name)} />
                  </Fragment>
                ))}
              </div>
            )}
            <p className={note}>{countLine(entries)}</p>
          </>
        )}
      </div>
    </div>
  )
}

function Entry({ entry, onOpen }: { entry: WorkspaceEntry; onOpen: () => void }) {
  const name = <span className="min-w-0 flex-1 truncate text-[13px]/[18px]">{entry.name}</span>
  if (!entry.directory)
    return (
      <div className={row}>
        <FileIcon className="size-[15px] flex-none text-muted-foreground" strokeWidth={1.75} />
        {name}
        <span className="flex-none text-xs/[18px] text-muted-foreground">{formatBytes(entry.size)}</span>
      </div>
    )
  return (
    <button type="button" onClick={onOpen} className={`${row} outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`}>
      <FolderIcon className="size-[15px] flex-none text-muted-foreground" strokeWidth={1.75} />
      {name}
      <ChevronRightIcon className="size-3.5 flex-none text-foreground/40" strokeWidth={1.75} />
    </button>
  )
}
