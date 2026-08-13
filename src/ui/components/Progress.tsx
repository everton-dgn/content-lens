import { Progress as ProgressPrimitive } from 'radix-ui'
import { useId } from 'react'

export type ProgressProps = {
  description?: string
  label: string
  max?: number
  value?: number
  valueLabel?: string
}

export const Progress = ({
  description,
  label,
  max = 100,
  value,
  valueLabel
}: ProgressProps) => {
  const id = useId()
  const labelId = `${id}-label`
  const descriptionId = description ? `${id}-description` : undefined
  const normalizedValue = Math.max(
    0,
    Math.min(100, value === undefined ? 0 : (value / max) * 100)
  )

  return (
    <div className="cl-progress" data-slot="progress">
      <div className="cl-progress__heading">
        <span id={labelId}>{label}</span>
        {valueLabel ? <strong>{valueLabel}</strong> : null}
      </div>
      <progress
        className="cl-visually-hidden"
        aria-describedby={descriptionId}
        aria-labelledby={labelId}
        max={max}
        value={value}
      />
      <ProgressPrimitive.Root
        aria-describedby={descriptionId}
        aria-labelledby={labelId}
        className="cl-progress__bar"
        max={max}
        value={value}
      >
        <ProgressPrimitive.Indicator asChild>
          <svg
            aria-hidden="true"
            preserveAspectRatio="none"
            viewBox="0 0 100 4"
          >
            <rect className="cl-progress__track" height="4" width="100" />
            <rect
              className="cl-progress__value"
              height="4"
              width={normalizedValue}
            />
          </svg>
        </ProgressPrimitive.Indicator>
      </ProgressPrimitive.Root>
      {description ? <small id={descriptionId}>{description}</small> : null}
    </div>
  )
}
