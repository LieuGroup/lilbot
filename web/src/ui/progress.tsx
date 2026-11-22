import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import { cn } from 'cn'

function Progress({ className, value, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root value={value} data-slot="progress" className={cn('w-full', className)} {...props}>
      <ProgressPrimitive.Track className="relative flex h-1.5 w-full items-center overflow-hidden rounded-[3px] bg-hairline" data-slot="progress-track">
        <ProgressPrimitive.Indicator className="h-full rounded-[3px] bg-foreground transition-all" data-slot="progress-indicator" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
