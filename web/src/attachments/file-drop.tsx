import { UploadIcon } from 'lucide-react'
import { type DragEvent, useRef, useState } from 'react'

import { type AttachmentLimits, dropHint } from './attachment-rules'

const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

/** Drag handlers for the conversation column. Entering and leaving child elements fires many
 *  events, so a counter decides when the files have really left. Text or links being dragged are
 *  ignored. */
export function useFileDrop(onFiles: (files: File[]) => void, enabled: boolean) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const reset = () => {
    depth.current = 0
    setDragging(false)
  }
  const handlers = {
    onDragEnter: (event: DragEvent) => {
      if (!enabled || !carriesFiles(event)) return
      event.preventDefault()
      depth.current++
      setDragging(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!enabled || !carriesFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (event: DragEvent) => {
      if (!enabled || !carriesFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    },
    onDrop: (event: DragEvent) => {
      if (!enabled || !carriesFiles(event)) return
      event.preventDefault()
      reset()
      onFiles(Array.from(event.dataTransfer.files))
    }
  }
  return { dragging: enabled && dragging, handlers }
}

/** Covers the message list while files are dragged over the conversation (Paper "10 Attachments",
 *  panel 3). The limits come from the server. */
export function DropOverlay({ limits }: { limits: AttachmentLimits | undefined }) {
  return (
    <div className="pointer-events-none absolute inset-0 bg-card px-4 py-5 md:px-8">
      <div className="mx-auto flex h-full max-w-[680px] flex-col items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-foreground/30 bg-foreground/3">
        <UploadIcon className="size-[22px]" strokeWidth={1.75} />
        <p className="text-sm/5 font-medium">Drop to attach</p>
        {limits && <p className="text-xs/4 text-muted-foreground">{dropHint(limits)}</p>}
      </div>
    </div>
  )
}
