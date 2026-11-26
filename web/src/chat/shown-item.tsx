/** A file a bot showed in its reply (#317, Paper artboard 27, row A): an image that opens in the viewer, a video that
 *  plays in place, or (until the sandboxed view, slice 3) a plain line for an HTML page. One width rule for every
 *  kind: the reply's width, at most 420. A file that is gone or grew past its limit draws as one plain line. The file's
 *  name and the caption are the bot's text, drawn as plain text. */
import { FileCodeIcon, FileXIcon } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useState } from 'react'

import type { ViewedImage } from '@/ui/image-viewer'
import { formatBytes } from '../../../shared/client/attachments/attachment-rules'
import { SHOW_LIMITS, type ShownProblem, shownProblem, shownProblemText } from '../../../shared/shown-rules'
import type { ShownFile } from '../../../shared/shown-schema'

const ImageViewer = lazy(() => import('@/ui/image-viewer'))

type Missing = ShownProblem

/** Why the file did not load: the route answers 413 for a file past its limit, 404 for one that is gone, and 200 for
 *  one that is there but this browser cannot draw (a clip in a codec it does not play). */
async function whyMissing(url: string): Promise<Missing> {
  const status = await fetch(url, { method: 'HEAD', cache: 'no-store' }).then(
    res => res.status,
    () => 404
  )
  return shownProblem(status)
}

export default function ShownItem({ file, botName }: { file: ShownFile; botName?: string }) {
  const [missing, setMissing] = useState<Missing>()
  const [viewed, setViewed] = useState<ViewedImage>()
  const fail = () => void whyMissing(file.url).then(setMissing)
  if (missing) return <ShownLine file={file} icon={<FileXIcon />} detail={missingText(missing, file, botName)} />
  if (file.kind === 'page') return <ShownLine file={file} icon={<FileCodeIcon />} detail={`HTML view · ${formatBytes(file.size)}`} />
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

function missingText(missing: Missing, file: ShownFile, botName?: string) {
  return shownProblemText(missing, formatBytes(SHOW_LIMITS.bytes[file.kind]), botName)
}

/** One plain line, never an error colour (A4): the file's name and why it is not drawn, or the HTML placeholder. */
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
