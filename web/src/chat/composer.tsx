import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react'

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/ui/input-group'

interface ComposerProps {
  disabled: boolean
  running: boolean
  botName: string
  onSend: (text: string) => void
  onStop: () => void
}

/** The Prompt Input pattern: plain props in, plain callbacks out. */
export function Composer({ disabled, running, botName, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState('')
  const form = useRef<HTMLFormElement>(null)

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
    <footer className="px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
      <form ref={form} onSubmit={submit} className="mx-auto max-w-3xl">
        <InputGroup>
          <InputGroupTextarea
            value={text}
            aria-label="Message"
            placeholder={disabled ? 'Connecting...' : `Message ${botName}`}
            className="max-h-52 p-3 text-base"
            onChange={event => setText(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <InputGroupAddon align="block-end" className="justify-end">
            {running && (
              <InputGroupButton size="icon-sm" variant="outline" className="rounded-full" aria-label="Stop" onClick={onStop}>
                <SquareIcon />
              </InputGroupButton>
            )}
            <InputGroupButton type="submit" size="icon-sm" variant="default" className="rounded-full" aria-label="Send" disabled={disabled || !text.trim()}>
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </footer>
  )
}
