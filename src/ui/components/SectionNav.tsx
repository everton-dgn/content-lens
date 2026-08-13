import type { LucideIcon } from 'lucide-react'
import type { MouseEvent } from 'react'

import { Button } from './Button'

export type SectionNavItem<Value extends string> = {
  label: string
  icon?: LucideIcon
  value: Value
}

export type SectionNavVariant = 'compact' | 'primary' | 'tabs'

export type SectionNavProps<Value extends string> = {
  ariaLabel: string
  items: readonly SectionNavItem<Value>[]
  onChange(value: Value): void
  variant?: SectionNavVariant
  value: Value
}

export const SectionNav = <Value extends string>({
  ariaLabel,
  items,
  onChange,
  variant = 'tabs',
  value
}: SectionNavProps<Value>) => {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const next = event.currentTarget.dataset.value
    if (next) {
      onChange(next as Value)
    }
  }

  return (
    <nav
      aria-label={ariaLabel}
      className="cl-section-nav"
      data-slot="section-nav"
      data-variant={variant}
    >
      {items.map(item => {
        const Icon = item.icon
        return (
          <Button
            aria-current={value === item.value ? 'page' : undefined}
            data-value={item.value}
            key={item.value}
            onClick={handleClick}
            size="compact"
            variant="quiet"
          >
            {Icon ? <Icon aria-hidden="true" /> : null}
            {item.label}
          </Button>
        )
      })}
    </nav>
  )
}
