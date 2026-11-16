import { cn } from 'cn'

import { buttonVariants } from '@/ui/button'

/** The 28px square button that holds a 16px icon (roster header, chat header). `on` marks a
 *  toggle that is pressed. Use it as the className of a Button or a Link. */
export function iconButton({ on = false, className }: { on?: boolean; className?: string } = {}) {
  return cn(
    buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
    'rounded-[6px] text-muted-foreground hover:bg-foreground/4 hover:text-foreground dark:hover:bg-foreground/6 [&_svg]:stroke-[1.75]',
    on && 'bg-foreground/6 text-foreground hover:bg-foreground/8',
    className
  )
}
