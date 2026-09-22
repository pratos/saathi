import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out outline-none active:scale-[.98] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 aria-invalid:border-destructive aria-invalid:ring-destructive/20 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg:not([class*="size-"])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20',
        destructiveQuiet: 'text-destructive hover:bg-destructive/10 focus-visible:ring-destructive/20',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        outline: 'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        bare: 'rounded-none bg-transparent p-0 text-inherit shadow-none hover:bg-transparent',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        xs: 'h-7 gap-1 rounded-sm px-2 text-xs has-[>svg]:px-1.5',
        sm: 'h-8 gap-1.5 px-3 text-xs has-[>svg]:px-2.5',
        lg: 'h-10 px-6 has-[>svg]:px-4',
        icon: 'size-9 p-0',
        'icon-sm': 'size-8 p-0',
        'icon-lg': 'size-10 p-0',
        content: 'h-auto min-h-0 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
