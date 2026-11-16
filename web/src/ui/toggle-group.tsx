import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group'
import { cn } from 'cn'

// A two- or three-option switch (Paper "03 Delete bot"): a tinted track with the chosen option
// raised on a card. Base UI lets the pressed option be clicked off; callers keep one chosen.
function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props) {
  return <ToggleGroupPrimitive data-slot="toggle-group" className={cn('flex w-fit flex-none rounded-lg bg-foreground/6 p-0.5', className)} {...props} />
}

function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        'rounded-[6px] px-2.5 py-[5px] text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-pressed:bg-card data-pressed:text-foreground data-pressed:shadow-[0_0_0_1px_--alpha(var(--color-foreground)/6%),0_1px_2px_--alpha(var(--color-foreground)/8%)]',
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
