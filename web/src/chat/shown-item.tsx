/** A file a bot showed in its reply (#317, Paper artboard 27, row A): an image that opens in the viewer, a video that
 *  plays in place, or an HTML page in a sandboxed frame (`page-view.tsx`, loaded with the first page). One width rule
 *  for every kind: the reply's width, at most 420. A file that is gone or grew past its limit draws as one plain line
 *  with its name and why (A4: no caption on it). The file's name and the caption are the bot's text, drawn as plain text. */
import { FileXIcon } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useCallback, useState } from 'react'

import type { ViewedImage } from '@/ui/image-viewer'
import { formatBytes } from '../../../shared/client/attachments/attachment-rules'
import { type Missing, whyMissing } from '../../../shared/client/chat/shown-load'
import { SHOW_LIMITS } from '../../../shared/shown-rules'
import type { ShownFile } from '../../../shared/shown-schema'

const ImageViewer = lazy(() => import('@/ui/image-viewer'))
const PageView = lazy(() => import('./page-view'))
const PAGE_RESERVE = 192

export default function ShownItem({ file, botName }: { file: ShownFile; botName?: string }) {
  const [missing, setMissing] = useState<Missing>()
  const [viewed, setViewed] = useState<ViewedImage>()
  const fail = () => void whyMissing(file.url).then(setMissing)
  const onMissing = useCallback((why: Missing) => setMissing(why), [])
  if (missing) return <ShownLine file={file} icon={<FileXIcon />} detail={missingText(missing, file, botName)} />
  if (file.kind === 'page')
    return (
      <Suspense fallback={<div className="w-full max-w-[420px] rounded-lg bg-card ring-1 ring-hairline" style={{ height: PAGE_RESERVE }} />}>
        <PageView file={file} onMissing={onMissing} />
      </Suspense>
    )
  return (
    <figure data-shown={file.kind} className="m-0 flex w-full max-w-[420px] flex-col gap-1.5">
      {file.kind === 'image' ? (
        <button
          type="button"
          onClick={() => setViewed({ url: file.url, name: file.name })}
          aria-label={`Open ${file.name}`}
          className="block w-fit max-w-full overflow-hidden rounded-lg ring-1 ring-foreground/8 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img src={file.url} alt={file.caption ?? file.name} onError={fail} className="block max-h-[420px] max-w-full object-contain" />
        </button>
      ) : (
        // biome-ignore lint/a11y/useMediaCaption: a bot's own clip has no caption track; the caption line names it.
        <video src={file.url} controls preload="metadata" playsInline onError={fail} className="block max-h-[420px] w-full rounded-lg bg-black" />
      )}
      <figcaption className="flex min-w-0 gap-1.5 pl-0.5 text-[13px]/[18px]">
        {file.caption && <span className="min-w-0 truncate text-foreground">{file.caption}</span>}
        <span className={`truncate text-muted-foreground${file.caption ? ' flex-none max-w-[60%]' : ''}`}>
          {file.caption ? '· ' : ''}
          {file.name} · {formatBytes(file.size)}
        </span>
      </figcaption>
      {viewed && (
        <Suspense fallback={null}>
          <ImageViewer image={viewed} onClose={() => setViewed(undefined)} />
        </Suspense>
      )}
    </figure>
  )
}

export function missingText(missing: Missing, file: Pick<ShownFile, 'kind'>, botName?: string) {
  const limit = `limit ${formatBytes(SHOW_LIMITS.bytes[file.kind])}`
  if (missing.kind === 'too_large') return `Too large to show here (${missing.size ? `${formatBytes(missing.size)}, ` : ''}${limit})`
  return `No longer in ${botName || 'the bot'}'s folder`
}

/** One plain line, never an error colour (A4): the file's name and why it is not drawn. */
function ShownLine({ file, icon, detail }: { file: ShownFile; icon: ReactNode; detail: string }) {
  return (
    <div data-shown-line className="flex w-full max-w-[420px] items-center gap-2.5 rounded-md bg-card px-3 py-2.25 ring-1 ring-hairline">
      <span className="flex-none text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="flex min-w-0 flex-col gap-px">
        <span className="truncate text-[13px]/[18px] font-medium text-foreground">{file.name}</span>
        <span className="text-xs/4 text-muted-foreground">{detail}</span>
      </span>
    </div>
  )
}
