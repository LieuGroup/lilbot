import { FileIcon, LoaderCircleIcon, XIcon } from 'lucide-react'

import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle } from '@/ui/attachment'
import { ComposerNote } from '@/ui/composer-note'
import { formatBytes, leftOutText, refusalText } from './attachment-rules'
import type { StagedAttachments, StagedFile } from './use-staged-attachments'

/** The Prompt Input pattern's attachment row (Paper "10 Attachments", panels 1 and 3): images as
 *  64px tiles, files as chips, each with a round remove button on its corner; refused files and
 *  the "left out" line as red-outlined rows below them. Names are plain text. */
export function ComposerAttachments({ staged }: { staged: StagedAttachments }) {
  const kept = staged.files.filter(file => file.state !== 'refused')
  const refused = staged.files.filter(file => file.state === 'refused')
  return (
    <div className="flex w-full min-w-0 cursor-default flex-col gap-1.5 font-normal text-foreground select-auto">
      {kept.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-[5px] pr-[5px]">
          {kept.map(file => (file.preview ? <ImageTile key={file.key} file={file} onRemove={staged.remove} /> : <FileChip key={file.key} file={file} onRemove={staged.remove} />))}
        </div>
      )}
      {refused.map(file => (
        <ComposerNote key={file.key} label={`Remove ${file.name}`} onDismiss={() => staged.remove(file.key)}>
          <AttachmentTitle className="text-[13px]/[18px]">{file.name}</AttachmentTitle>
          <AttachmentDescription className="mt-0 text-xs/4 text-destructive!">{refusalText({ size: file.size, reason: file.reason }, staged.limits)}</AttachmentDescription>
        </ComposerNote>
      ))}
      {staged.leftOut > 0 && staged.limits && (
        <ComposerNote label="Dismiss" onDismiss={staged.dismissLeftOut}>
          <p className="text-[13px]/[18px] text-destructive">{leftOutText(staged.leftOut, staged.limits)}</p>
        </ComposerNote>
      )}
    </div>
  )
}

const waiting = (file: StagedFile) => file.state === 'preparing' || file.state === 'uploading'

function ImageTile({ file, onRemove }: { file: StagedFile; onRemove: (key: string) => void }) {
  return (
    <Attachment state={waiting(file) ? 'uploading' : 'done'} title={file.name} className="size-16 min-w-0 rounded-xl border-0 bg-muted p-0! ring-1 ring-foreground/8 ring-inset">
      <AttachmentMedia variant={waiting(file) ? 'icon' : 'image'} className="size-full rounded-xl bg-transparent">
        {waiting(file) ? <Spinner /> : <img src={file.preview} alt={file.name} className="size-full object-cover" />}
      </AttachmentMedia>
      <RemoveButton file={file} onRemove={onRemove} />
    </Attachment>
  )
}

function FileChip({ file, onRemove }: { file: StagedFile; onRemove: (key: string) => void }) {
  return (
    <Attachment
      state={waiting(file) ? 'uploading' : 'done'}
      className="h-16 min-w-0 gap-2 rounded-xl border-0 bg-background py-0! pr-3.5! pl-2.5! ring-1 ring-foreground/8 ring-inset"
    >
      <AttachmentMedia className="size-8 rounded-lg bg-card text-muted-foreground">{waiting(file) ? <Spinner /> : <FileIcon strokeWidth={1.75} />}</AttachmentMedia>
      <AttachmentContent className="max-w-48">
        <AttachmentTitle className="text-[13px]/[18px]">{file.name}</AttachmentTitle>
        <AttachmentDescription className="mt-0 text-xs/4">{file.state === 'uploading' ? 'Uploading...' : formatBytes(file.size)}</AttachmentDescription>
      </AttachmentContent>
      <RemoveButton file={file} onRemove={onRemove} />
    </Attachment>
  )
}

const Spinner = () => <LoaderCircleIcon className="size-[18px]! animate-spin text-primary" strokeWidth={2.5} aria-label="Uploading" />

function RemoveButton({ file, onRemove }: { file: StagedFile; onRemove: (key: string) => void }) {
  return (
    <AttachmentActions className="absolute! -top-[5px] -right-[5px]">
      <AttachmentAction
        aria-label={`Remove ${file.name}`}
        title="Remove"
        onClick={() => onRemove(file.key)}
        className="size-[18px] rounded-full bg-foreground text-background ring-2 ring-card hover:bg-foreground/80 hover:text-background [&_svg]:size-2.5!"
      >
        <XIcon strokeWidth={3} />
      </AttachmentAction>
    </AttachmentActions>
  )
}
