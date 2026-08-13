import type { PanelStatus } from '@/ui/styles/tokens/contract'

const statusMarks: Record<PanelStatus, typeof Check> = {
  degraded: AlertTriangle,
  error: CircleX,
  loading: LoaderCircle,
  offline: Circle,
  ready: Check
}

export type StatusRailProps = {
  label: string
  status: PanelStatus
}

export const StatusRail = ({ label, status }: StatusRailProps) => {
  const Mark = statusMarks[status]
  return (
    <aside
      aria-atomic="true"
      aria-live="polite"
      className="cl-status-rail"
      data-slot="status-rail"
      data-status={status}
      role="status"
    >
      <span aria-hidden="true" className="cl-status-rail__marker">
        <Mark />
      </span>
      <p className="cl-status-rail__label">{label}</p>
    </aside>
  )
}

import {
  AlertTriangle,
  Check,
  Circle,
  CircleX,
  LoaderCircle
} from 'lucide-react'
