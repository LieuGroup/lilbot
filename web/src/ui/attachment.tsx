import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import type * as React from 'react'

import { Button } from '@/ui/button'

function Attachment({ className, state = 'done', ...props }: React.ComponentProps<'div'> & { state?: 'uploading' | 'error' | 'done' }) {
  return (
    <div
      data-slot="attachment"
      data-state={state}
      className={cn(
        'group/attachment relative flex w-fit max-w-full min-w-0 shrink-0 flex-wrap rounded-xl border bg-card text-card-foreground transition-colors focus-within:ring-1 focus-within:ring-ring/50 has-[>a,>button]:hover:bg-muted/50 data-[state=error]:border-destructive/30',
        'gap-2 text-sm has-data-[slot=attachment-content]:px-2.5 has-data-[slot=attachment-content]:py-2 has-data-[slot=attachment-media]:p-2 min-w-40 items-center',
        className
      )}
      {...props}
    />
  )
}

const attachmentMediaVariants = cva(
  "relative flex aspect-square w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-foreground group-data-[state=error]/attachment:bg-destructive/10 group-data-[state=error]/attachment:text-destructive [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        icon: '',
        image: 'opacity-60 group-data-[state=done]/attachment:opacity-100 group-data-[state=idle]/attachment:opacity-100 *:[img]:aspect-square *:[img]:w-full *:[img]:object-cover'
      }
    },
    defaultVariants: {
      variant: 'icon'
    }
  }
)

function AttachmentMedia({ className, variant = 'icon', ...props }: React.ComponentProps<'div'> & VariantProps<typeof attachmentMediaVariants>) {
  return <div data-slot="attachment-media" data-variant={variant} className={cn(attachmentMediaVariants({ variant }), className)} {...props} />
}

function AttachmentContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="attachment-content" className={cn('max-w-full min-w-0 flex-1 leading-tight', className)} {...props} />
}

function AttachmentTitle({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="attachment-title" className={cn('block max-w-full min-w-0 truncate font-medium group-data-[state=uploading]/attachment:shimmer', className)} {...props} />
}

function AttachmentDescription({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="attachment-description"
      className={cn('mt-0.5 block min-w-0 truncate text-xs text-muted-foreground group-data-[state=error]/attachment:text-destructive/80', 'max-w-full', className)}
      {...props}
    />
  )
}

function AttachmentActions({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="attachment-actions" className={cn('relative z-20 flex shrink-0 items-center', className)} {...props} />
}

function AttachmentAction({ className, variant, size = 'icon-xs', ...props }: React.ComponentProps<typeof Button>) {
  return <Button data-slot="attachment-action" variant={variant ?? 'ghost'} size={size} className={cn(className)} {...props} />
}

export { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle }
