import * as ProgressPrimitive from '@radix-ui/react-progress'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Progress({ className, value, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  return <ProgressPrimitive.Root data-slot="progress" className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/15', className)} {...props}><ProgressPrimitive.Indicator data-slot="progress-indicator" className="h-full w-full flex-1 bg-primary transition-transform" style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }} /></ProgressPrimitive.Root>
}
