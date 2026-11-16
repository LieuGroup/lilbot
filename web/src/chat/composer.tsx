import { type KeyboardEvent, useRef, useState } from 'react'

import { Button } from '../ui/controls'

interface ComposerProps {
  disabled: boolean
  running: boolean
  botName: string
  onSend: (text: string) => void
  onStop: () => void
}

export function Composer({ disabled, running, botName, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)

  const submit = () => {
    const value = text.trim()
    if (!value || disabled) return
    onSend(value)
    setText('')
    if (input.current) input.current.style.height = 'auto'
  }

  // Enter sends on a keyboard; on a phone Enter adds a line and the button sends.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (event.key === 'Enter' && !event.shiftKey && !touch && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <footer className="border-t border-border bg-surface px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={input}
          rows={1}
          value={text}
          aria-label="Message"
          placeholder={disabled ? 'Connecting...' : `Message ${botName}`}
          className="max-h-52 min-w-0 flex-1 resize-none rounded-xl border border-border bg-bg px-3 py-2.5 text-base placeholder:text-muted"
          onChange={event => {
            setText(event.target.value)
            event.target.style.height = 'auto'
            event.target.style.height = `${Math.min(event.target.scrollHeight, 208)}px`
          }}
          onKeyDown={onKeyDown}
        />
        {running && (
          <Button variant="danger" onClick={onStop}>
            Stop
          </Button>
        )}
        <Button onClick={submit} disabled={disabled || !text.trim()}>
          Send
        </Button>
      </div>
    </footer>
  )
}
