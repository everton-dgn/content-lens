import type { ReactNode } from 'react'

import type { ViewState } from '@/ui/styles/tokens/contract'

export type BadgeTone =
  | 'neutral'
  | Extract<ViewState, 'info' | 'success' | 'degraded'>

export type BadgeProps = {
  children: ReactNode
  tone?: BadgeTone
}

export const Badge = ({ children, tone = 'neutral' }: BadgeProps) => (
  <span className="cl-badge" data-slot="badge" data-tone={tone}>
    {children}
  </span>
)
