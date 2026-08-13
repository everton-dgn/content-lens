import type { ComponentPropsWithRef } from 'react'
import { tv } from 'tailwind-variants/lite'

export type ButtonProps = Omit<ComponentPropsWithRef<'button'>, 'style'> & {
  size?: 'default' | 'compact' | 'full'
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
}

const buttonVariants = tv({
  base: [
    'cl-button inline-flex appearance-none items-center justify-center',
    'min-h-[var(--cl-control-min-block)] gap-[var(--cl-space-2)]',
    'rounded-[var(--cl-radius-md)] border-[length:var(--cl-border-width)] border-transparent',
    'text-center font-[var(--cl-font-weight-semibold)] text-[length:var(--cl-font-size-sm)]',
    'leading-[var(--cl-line-height-tight)] no-underline',
    'transition-[background-color,border-color,color] duration-[var(--cl-motion-fast)]',
    'disabled:pointer-events-none',
    'disabled:cursor-not-allowed disabled:opacity-[var(--cl-opacity-disabled)]',
    '[&_svg]:pointer-events-none [&_svg]:size-[var(--cl-status-marker-size)] [&_svg]:shrink-0'
  ],
  variants: {
    variant: {
      primary: [
        'border-[var(--cl-color-action)] bg-[var(--cl-color-action)]',
        'text-[var(--cl-color-action-text)] hover:bg-[var(--cl-color-action-hover)]'
      ],
      secondary: [
        'border-[var(--cl-color-control-border)] bg-[var(--cl-color-surface)]',
        'text-[var(--cl-color-text)] hover:border-[var(--cl-color-action)]',
        'hover:bg-[var(--cl-color-surface-hover)]'
      ],
      quiet: [
        'bg-transparent font-[var(--cl-font-weight-medium)]',
        'text-[var(--cl-color-action-quiet)] hover:border-[var(--cl-color-action)]',
        'hover:bg-[var(--cl-color-surface-hover)]'
      ],
      danger: [
        'border-[var(--cl-color-error)]',
        'bg-[var(--cl-color-error-surface)] text-[var(--cl-color-error)]',
        'hover:bg-[var(--cl-color-error)] hover:text-[var(--cl-color-action-text)]'
      ]
    },
    size: {
      default: 'px-[var(--cl-space-4)] py-[var(--cl-space-2)]',
      compact: 'px-[var(--cl-space-3)] py-[var(--cl-space-2)]',
      full: 'w-full px-[var(--cl-space-4)] py-[var(--cl-space-2)]'
    }
  },
  defaultVariants: { size: 'default', variant: 'primary' }
})

export const Button = ({
  className,
  size = 'default',
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) => (
  <button
    className={buttonVariants({ className, size, variant })}
    data-size={size}
    data-slot="button"
    data-variant={variant}
    type={type}
    {...props}
  />
)
