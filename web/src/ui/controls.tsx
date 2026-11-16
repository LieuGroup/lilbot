/** Small shared form and button parts, so pages look the same without repeating class lists. */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const inputClass = 'w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-base text-text placeholder:text-muted disabled:opacity-50'

const buttonStyles = {
  primary: 'bg-accent text-white',
  ghost: 'border border-border bg-transparent text-text',
  danger: 'border border-danger bg-transparent text-danger'
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button type="button" className={`min-h-11 rounded-xl px-4 py-2 font-medium disabled:cursor-default disabled:opacity-45 ${buttonStyles[variant]} ${className}`} {...props} />
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as `children`, inside the label
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  )
}

export const TextInput = (props: InputHTMLAttributes<HTMLInputElement>) => <input className={inputClass} {...props} />
export const TextArea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={`${inputClass} resize-y`} {...props} />
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select className={inputClass} {...props} />

export function Notice({ tone, children }: { tone: 'error' | 'ok'; children: ReactNode }) {
  const color = tone === 'error' ? 'border-danger text-danger' : 'border-ok text-ok'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2 text-sm ${color}`}>
      {children}
    </div>
  )
}

/** Round badge with the bot's initial. */
export function BotBadge({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="flex size-9 flex-none items-center justify-center rounded-full bg-accent/15 font-semibold text-accent">
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}
