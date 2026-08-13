import type { ReactElement, ReactNode } from 'react'

import type { ButtonProps } from '@/ui/components/Button'
import type { ViewState } from '@/ui/styles/tokens/contract'

const stateMarks: Record<ViewState, typeof Info> = {
  degraded: AlertTriangle,
  empty: Inbox,
  error: CircleAlert,
  info: Info,
  loading: LoaderCircle,
  offline: Circle,
  success: CheckCircle2
}

export type StatePanelProps = {
  children?: ReactNode
  description: string
  eyebrow: string
  primaryAction?: ReactElement<ButtonProps>
  state: ViewState
  title: string
}

export const StatePanel = ({
  children,
  description,
  eyebrow,
  primaryAction,
  state,
  title
}: StatePanelProps) => {
  const Mark = stateMarks[state]
  return (
    <section
      aria-busy={state === 'loading' ? true : undefined}
      className="cl-state-panel"
      data-slot="state-panel"
      data-state={state}
      role={
        state === 'error'
          ? 'alert'
          : state === 'loading' || state === 'success'
            ? 'status'
            : undefined
      }
    >
      <div className="cl-state-panel__summary">
        <div className="cl-state-panel__kicker">
          <span aria-hidden="true" className="cl-state-panel__signal">
            <Mark />
          </span>
          <p className="cl-state-panel__eyebrow">{eyebrow}</p>
        </div>
        <h2 className="cl-state-panel__title">{title}</h2>
        <p className="cl-state-panel__description">{description}</p>
      </div>
      {primaryAction ? (
        <div className="cl-state-panel__actions">{primaryAction}</div>
      ) : null}
      {children}
    </section>
  )
}

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleAlert,
  Inbox,
  Info,
  LoaderCircle
} from 'lucide-react'
