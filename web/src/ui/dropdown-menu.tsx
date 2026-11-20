import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { cn } from 'cn'
import { CheckIcon, ChevronRightIcon, SearchIcon } from 'lucide-react'
import type * as React from 'react'

// LilBot's menu (Paper "02 Bot menu"): a 208px card, radius 12, a 10% ring and a soft shadow,
// 30px rows of 13px text, 15px icons at stroke 1.5 in the muted colour.
const item =
  "relative flex h-[30px] cursor-default items-center gap-2.5 rounded-[6px] px-2 text-[13px]/[18px] text-foreground outline-hidden select-none focus:bg-foreground/6 data-highlighted:bg-foreground/6 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg:not([class*='size-'])]:size-[15px] [&_svg:not([class*='text-'])]:text-muted-foreground"

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

/** Makes the menu inside it searchable: add `DropdownMenuInput` and put the items in `DropdownMenuList`. */
const DropdownMenuFilter = MenuPrimitive.FilterProvider

/** The search box of a filterable menu (Paper "14 Model picker"). 16px text on phones, so focusing it does not zoom. */
function DropdownMenuInput({ className, ...props }: MenuPrimitive.Input.Props) {
  return (
    <label className="flex flex-none items-center gap-2 rounded-[6px] px-2 py-1.5 ring-1 ring-foreground/12 ring-inset">
      <SearchIcon className="size-3.5 flex-none text-muted-foreground" strokeWidth={1.75} />
      <MenuPrimitive.Input
        data-slot="dropdown-menu-input"
        className={cn('min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-foreground/50 md:text-[13px]/[18px]', className)}
        {...props}
      />
    </label>
  )
}

function DropdownMenuList({ className, ...props }: MenuPrimitive.List.Props) {
  return <MenuPrimitive.List data-slot="dropdown-menu-list" className={cn('flex min-h-0 flex-col overflow-y-auto', className)} {...props} />
}

function DropdownMenuEmpty({ className, ...props }: MenuPrimitive.Empty.Props) {
  return <MenuPrimitive.Empty data-slot="dropdown-menu-empty" className={cn('px-2 py-1.5 text-[13px]/[18px] text-muted-foreground empty:hidden', className)} {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = 'start',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  anchor,
  className,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'anchor'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner className="isolate z-50 outline-none" align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} anchor={anchor}>
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            'z-50 flex max-h-(--available-height) w-[208px] origin-(--transform-origin) flex-col overflow-x-hidden overflow-y-auto rounded-xl bg-popover p-1.5 text-popover-foreground shadow-[0_10px_24px_-6px_--alpha(var(--color-foreground)/16%)] dark:shadow-[0_10px_24px_-6px_--alpha(var(--color-background)/80%)] ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95',
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return <MenuPrimitive.GroupLabel data-slot="dropdown-menu-label" className={cn('px-2 pt-1.5 pb-1 text-xs text-muted-foreground', className)} {...props} />
}

function DropdownMenuItem({ className, variant = 'default', ...props }: MenuPrimitive.Item.Props & { variant?: 'default' | 'destructive' }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        item,
        'data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/8 data-[variant=destructive]:[&_svg]:text-destructive',
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({ className, children, ...props }: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger data-slot="dropdown-menu-sub-trigger" className={cn(item, 'data-popup-open:bg-foreground/6', className)} {...props}>
      {children}
      <ChevronRightIcon className="ml-auto size-[13px] text-foreground/40" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({ align = 'start', alignOffset = -6, side = 'right', sideOffset = 4, className, ...props }: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn('w-auto max-w-[240px] min-w-[176px]', className)}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem data-slot="dropdown-menu-radio-item" className={cn(item, 'pr-8', className)} {...props}>
      <span className="pointer-events-none absolute right-2 flex items-center justify-center" data-slot="dropdown-menu-radio-item-indicator">
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon className="text-foreground" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return <MenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn('h-px flex-none bg-hairline', className)} {...props} />
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuFilter,
  DropdownMenuGroup,
  DropdownMenuInput,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuList,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
}
