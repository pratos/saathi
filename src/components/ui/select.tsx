import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export const Select = SelectPrimitive.Root
export const SelectValue = SelectPrimitive.Value
export const SelectGroup = SelectPrimitive.Group

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger className={cn('flex h-11 w-full items-center justify-between rounded-xl border border-border bg-secondary px-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-ring/50 data-[placeholder]:text-muted-foreground', className)} {...props}>
    {children}<SelectPrimitive.Icon><ChevronDown className="size-4 text-muted-foreground" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
}

export function SelectContent({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal><SelectPrimitive.Content className={cn('z-[300] max-h-72 min-w-[12rem] overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl', className)} position="popper" {...props}><SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport></SelectPrimitive.Content></SelectPrimitive.Portal>
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label className={cn('px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground', className)} {...props} />
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item className={cn('relative flex cursor-default select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm outline-none focus:bg-secondary data-[disabled]:opacity-50', className)} {...props}><span className="absolute left-2 grid size-4 place-items-center"><SelectPrimitive.ItemIndicator><Check className="size-4 text-primary" /></SelectPrimitive.ItemIndicator></span><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText></SelectPrimitive.Item>
}
