import { brandMarkGeometry, brandMarkViewBox } from '@/ui/brand/mark'

export type BrandProps = {
  name: string
  variant?: 'lockup' | 'mark'
}

const { frame, decision, signal } = brandMarkGeometry

export const Brand = ({ name, variant = 'lockup' }: BrandProps) => (
  <span className="cl-brand" data-slot="brand" data-variant={variant}>
    <svg
      aria-hidden="true"
      className="cl-brand__mark"
      focusable="false"
      viewBox={brandMarkViewBox}
    >
      <path
        className="cl-brand__frame"
        d={frame.path}
        fill="none"
        strokeLinejoin="round"
        strokeWidth={frame.strokeWidth}
      />
      <rect
        className="cl-brand__decision"
        height={decision.height}
        rx={decision.radius}
        width={decision.width}
        x={decision.x}
        y={decision.y}
      />
      <circle
        className="cl-brand__signal"
        cx={signal.left.centerX}
        cy={signal.y}
        r={signal.radius}
      />
      <rect
        className="cl-brand__signal"
        height={signal.barHeight}
        rx={signal.barRadius}
        width={signal.barWidth}
        x={signal.left.barX}
        y={signal.barY}
      />
      <circle
        className="cl-brand__signal"
        cx={signal.right.centerX}
        cy={signal.y}
        r={signal.radius}
      />
      <rect
        className="cl-brand__signal"
        height={signal.barHeight}
        rx={signal.barRadius}
        width={signal.barWidth}
        x={signal.right.barX}
        y={signal.barY}
      />
    </svg>
    <span className="cl-brand__name">{name}</span>
  </span>
)
