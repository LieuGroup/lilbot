/** A bot's HTML page in the reply (#317, artboard 27 A3): its text, fetched and drawn in the shared sandboxed frame
 *  (`ui/sandboxed-page.tsx`), at the width rule of every item (the reply's width, at most 420) and a fixed height with
 *  scrolling inside. With no sandbox permissions the page's scripts never run, so it cannot report its height. The frame
 *  is never given the file's own address, and nothing here opens it. */
import { useEffect, useState } from 'react'
import { formatBytes } from '../../../shared/client/attachments/attachment-rules'
import { loadPage, type Missing } from '../../../shared/client/chat/shown-load'
import type { ShownFile } from '../../../shared/shown-schema'
import { SandboxedPage } from '../ui/sandboxed-page'

/** The view frame's height in artboard 27 A3. */
export const PAGE_HEIGHT = 192

/** The view with its text; drawn as-is in tests. */
export function PageFrame({ file, text }: { file: ShownFile; text: string }) {
  return (
    <figure data-shown="page" className="m-0 flex w-full max-w-[420px] flex-col gap-1.5">
      <SandboxedPage title={file.caption ?? file.name} text={text} style={{ height: PAGE_HEIGHT }} className="block w-full rounded-lg bg-white ring-1 ring-hairline" />
      <figcaption className="flex min-w-0 gap-1.5 pl-0.5 text-[13px]/[18px]">
        {file.caption && <span className="min-w-0 truncate text-foreground">{file.caption}</span>}
        <span className={`truncate text-muted-foreground${file.caption ? ' flex-none max-w-[60%]' : ''}`}>
          {file.caption ? '· ' : ''}
          {file.name} · HTML · {formatBytes(file.size)}
        </span>
      </figcaption>
    </figure>
  )
}

export default function PageView({ file, onMissing }: { file: ShownFile; onMissing: (missing: Missing) => void }) {
  const [text, setText] = useState<string>()
  useEffect(() => {
    let current = true
    void loadPage(file.url).then(result => {
      if (!current) return
      if ('text' in result) setText(result.text)
      else onMissing(result.missing)
    })
    return () => {
      current = false
    }
  }, [file.url, onMissing])
  if (text === undefined) return <div className="w-full max-w-[420px] rounded-lg bg-card ring-1 ring-hairline" style={{ height: PAGE_HEIGHT }} />
  return <PageFrame file={file} text={text} />
}
