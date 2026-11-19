import { ArrowUpIcon, PlusIcon } from 'lucide-react'
import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useRef, useState } from 'react'

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/ui/input-group'
import type { Attachment } from '../../../shared/attachment-schema'
import { ComposerAttachments } from '../attachments/composer-attachments'
import type { StagedAttachments } from '../attachments/use-staged-attachments'

interface ComposerProps {
  disabled: boolean
  /** Why the box cannot be used yet, shown as its placeholder. */
  disabledHint: string
  running: boolean
  botName: string
  /** Files waiting to go with the next message (plus button, paste, or a drop on the conversation). */
  staged: StagedAttachments
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
}

/** The Prompt Input pattern: plain props in, plain callbacks out. One round ink button: stop while
 *  the bot works and the box is empty, send otherwise (a message sent while it works waits its turn).
 *  Send waits until every staged file has uploaded; refused files are left behind. */
export function Composer({ disabled, disabledHint, running, botName, staged, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const hasContent = text.trim().length > 0 || staged.ready.length > 0
  const stopping = running && !text.trim() && staged.ready.length === 0 && !staged.busy
  const canSend = !disabled && !staged.busy && hasContent

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSend) return
    onSend(text.trim(), staged.ready)
    setText('')
    staged.clear()
  }

  // A pasted screenshot or copied file is attached; pasted text stays text.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    void staged.add(files)
  }

  // Enter sends on a keyboard; on a phone Enter adds a line and the button sends.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (event.key === 'Enter' && !event.shiftKey && !touch && !event.nativeEvent.isComposing) {
      event.preventDefault()
      form.current?.requestSubmit()
    }
  }

  return (
    <footer className="flex-none px-4 pb-[max(20px,env(safe-area-inset-bottom))] md:px-8">
      <form ref={form} onSubmit={submit} className="mx-auto max-w-[680px]">
        <input
          ref={picker}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={event => {
            void staged.add(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <InputGroup className="flex-row! flex-wrap items-end gap-x-2 gap-y-2.5 rounded-[22px] border-0 bg-card py-2 pr-2 pl-2.5 shadow-xs ring-1 shadow-foreground/5 ring-foreground/12 has-disabled:bg-card has-disabled:opacity-100 has-[[data-slot=input-group-control]:focus-visible]:ring-foreground/20 dark:bg-card dark:has-disabled:bg-card">
          {(staged.files.length > 0 || staged.leftOut > 0) && (
            <InputGroupAddon align="block-start" className="p-0">
              <ComposerAttachments staged={staged} />
            </InputGroupAddon>
          )}
          <InputGroupAddon className="p-0 has-[>button]:ml-0">
            <InputGroupButton
              size="icon-sm"
              className="size-7 rounded-full text-foreground"
              aria-label="Attach files"
              title="Attach files"
              disabled={disabled}
              onClick={() => picker.current?.click()}
            >
              <PlusIcon strokeWidth={1.75} />
            </InputGroupButton>
          </InputGroupAddon>
          <InputGroupTextarea
            value={text}
            aria-label="Message"
            placeholder={disabled ? disabledHint : `Message ${botName}`}
            className="max-h-52 min-h-7 min-w-0 basis-0 px-0 py-0.5 text-base placeholder:text-foreground/50 md:text-[15px]/6"
            onChange={event => setText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          <InputGroupAddon align="inline-end" className="p-0 has-[>button]:mr-0">
            {stopping ? (
              <InputGroupButton
                size="icon-sm"
                className="size-7 rounded-full bg-foreground text-background hover:bg-foreground/80 hover:text-background"
                aria-label="Stop"
                onClick={onStop}
              >
                <span className="size-[9px] rounded-[2px] bg-card" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                size="icon-sm"
                className="size-7 rounded-full bg-foreground text-background hover:bg-foreground/80 hover:text-background disabled:bg-foreground/20"
                aria-label={staged.busy ? 'Send (waiting for uploads)' : running ? 'Send after this turn' : 'Send'}
                title={staged.busy ? 'Waiting for the files to upload' : undefined}
                disabled={!canSend}
              >
                <ArrowUpIcon strokeWidth={2} />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </footer>
  )
}
