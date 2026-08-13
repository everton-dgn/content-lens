import type { ReactNode } from 'react'

import { cn } from '@/ui/lib/utils'

export type SurfaceProps = {
  children: ReactNode
  className?: string
  elevation?: 'flat' | 'raised'
  tone?: 'default' | 'subtle'
}

export const Surface = ({
  children,
  className,
  elevation = 'flat',
  tone = 'default'
}: SurfaceProps) => (
  <section
    className={cn('cl-surface', className)}
    data-elevation={elevation}
    data-slot="surface"
    data-tone={tone}
  >
    {children}
  </section>
)
