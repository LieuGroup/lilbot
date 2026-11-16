import { ArrowUpIcon, PlusIcon } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react'

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/ui/input-group'

interface ComposerProps {
  disabled: boolean
  /** Why the box cannot be used yet, shown as its placeholder. */
  disabledHint: string
  running: boolean
  botName: string
  onSend: (text: string) => void
  onStop: () => void
}

/** The Prompt Input pattern: plain props in, plain callbacks out. One round ink button: stop while
 *  the bot works and the box is empty, send otherwise (a message sent while it works waits its turn). */
export function Composer({ disabled, disabledHint, running, botName, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const stopping = running && !text.trim()

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const value = text.trim()
    if (!value || disabled) return
    onSend(value)
    setText('')
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
        <InputGroup className="items-end gap-2 rounded-[22px] border-0 bg-card py-2 pr-2 pl-2.5 shadow-xs ring-1 shadow-foreground/5 ring-foreground/12 has-disabled:bg-card has-disabled:opacity-100 has-[[data-slot=input-group-control]:focus-visible]:ring-foreground/20 dark:bg-card dark:has-disabled:bg-card">
          <InputGroupAddon className="p-0 has-[>button]:ml-0">
            {/* Attaching files needs a backend first; the place is kept for it. */}
            <InputGroupButton
              size="icon-sm"
              className="size-7 rounded-full text-muted-foreground"
              aria-label="Attach a file (not available yet)"
              title="Attaching files is not available yet"
              disabled
            >
              <PlusIcon strokeWidth={1.75} />
            </InputGroupButton>
          </InputGroupAddon>
          <InputGroupTextarea
            value={text}
            aria-label="Message"
            placeholder={disabled ? disabledHint : `Message ${botName}`}
            className="max-h-52 min-h-7 px-0 py-0.5 text-base placeholder:text-foreground/50 md:text-[15px]/6"
            onChange={event => setText(event.target.value)}
            onKeyDown={onKeyDown}
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
                aria-label={running ? 'Send after this turn' : 'Send'}
                disabled={disabled || !text.trim()}
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
