import { Link } from '@tanstack/react-router'
import { FileIcon, InfoIcon } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'

import { Attachment, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle } from '@/ui/attachment'
import type { ViewedImage } from '@/ui/image-viewer'
import type { ImageSupport, Attachment as SentFile } from '../../../shared/attachment-schema'
import { rememberDetailsOpen } from '../bots/details-tabs'
import { formatBytes, imageNoteText, isImage } from './attachment-rules'

const ImageViewer = lazy(() => import('@/ui/image-viewer'))

/** A sent message's files above its bubble (Paper "10 Attachments", panel 2): images as 120×150
 *  tiles side by side that open in the viewer, files as chips that download. The server's URLs
 *  serve both, so they reopen after a reload and on any device. Names are plain text. */
export function SentAttachments({ files }: { files: SentFile[] }) {
  const [viewed, setViewed] = useState<ViewedImage>()
  const [viewerLoaded, setViewerLoaded] = useState(false)
  const images = files.filter(isImage)
  const others = files.filter(file => !isImage(file))
  const open = (file: SentFile) => {
    setViewerLoaded(true)
    setViewed({ url: file.url, name: file.name })
  }
  return (
    <>
      {images.length > 0 && (
        <div className="flex max-w-[min(480px,85%)] flex-wrap justify-end gap-1.5 self-end">
          {images.map(file => (
            <Attachment key={file.id} className="h-[150px] w-[120px] min-w-0 overflow-hidden rounded-[14px] border-0 bg-muted p-0!">
              <AttachmentMedia variant="image" className="size-full rounded-none bg-transparent opacity-100!">
                <img src={file.url} alt={file.name} loading="lazy" className="size-full object-cover" />
              </AttachmentMedia>
              <button
                type="button"
                onClick={() => open(file)}
                aria-label={`Open ${file.name}`}
                title={file.name}
                className="absolute inset-0 z-10 rounded-[14px] ring-1 ring-foreground/8 outline-none ring-inset hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Attachment>
          ))}
        </div>
      )}
      {others.map(file => (
        <Attachment key={file.id} className="max-w-[min(480px,85%)] min-w-0 gap-2 self-end rounded-xl border-0 bg-background py-2! pr-3.5! pl-2! hover:bg-foreground/6!">
          <AttachmentMedia className="size-8 rounded-lg bg-card text-muted-foreground">
            <FileIcon strokeWidth={1.75} />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle className="text-[13px]/[18px]">{file.name}</AttachmentTitle>
            <AttachmentDescription className="mt-0 text-xs/4">{formatBytes(file.size)}</AttachmentDescription>
          </AttachmentContent>
          <a
            href={file.url}
            download={file.name}
            title={`Download ${file.name}`}
            className="absolute inset-0 z-10 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="sr-only">Download {file.name}</span>
          </a>
        </Attachment>
      ))}
      {viewerLoaded && (
        <Suspense fallback={null}>
          <ImageViewer image={viewed} onClose={() => setViewed(undefined)} />
        </Suspense>
      )}
    </>
  )
}

/** Under the message, only when the server knows the bot's model is text-only. */
export function ImageNote({ botId, images }: { botId: string; images: ImageSupport | undefined }) {
  const text = imageNoteText(images)
  if (!text) return null
  return (
    <div role="note" className="flex max-w-[min(480px,85%)] items-start gap-2 self-end rounded-[10px] bg-background px-3 py-2.5 text-[13px]/[18px]">
      <InfoIcon className="mt-0.5 size-3.5 flex-none text-muted-foreground" strokeWidth={1.75} />
      <p>
        {text}{' '}
        <Link to="/bots/$botId/$tab" params={{ botId, tab: 'setup' }} onClick={() => rememberDetailsOpen(true)} className="font-medium underline-offset-2 hover:underline">
          Change model
        </Link>
      </p>
    </div>
  )
}
