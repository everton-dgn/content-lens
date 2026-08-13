import { type ChangeEvent, useId, useState } from 'react'

import { Button } from '@/ui/components/Button'

export type SecretFieldProps = {
  autoComplete?: string
  disabled?: boolean
  error?: string
  hideLabel: string
  hint?: string
  label: string
  onChange(value: string): void
  revealLabel: string
  value: string
}

export const SecretField = ({
  autoComplete = 'off',
  disabled,
  error,
  hideLabel,
  hint,
  label,
  onChange,
  revealLabel,
  value
}: SecretFieldProps) => {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const [revealed, setRevealed] = useState(false)
  const actionLabel = revealed ? hideLabel : revealLabel
  const ActionIcon = revealed ? EyeOff : Eye
  const update = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.currentTarget.value)
  }
  const toggle = () => {
    setRevealed(current => !current)
  }

  return (
    <div className="cl-field" data-slot="secret-field">
      <label className="cl-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="cl-secret-field__control">
        <input
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          autoComplete={autoComplete}
          disabled={disabled}
          id={id}
          onChange={update}
          type={revealed ? 'text' : 'password'}
          value={value}
        />
        <Button
          aria-controls={id}
          aria-pressed={revealed}
          disabled={disabled || value.length === 0}
          onClick={toggle}
          size="compact"
          variant="quiet"
        >
          <ActionIcon aria-hidden="true" />
          {actionLabel}
        </Button>
      </div>
      {hint ? (
        <p className="cl-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="cl-field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

import { Eye, EyeOff } from 'lucide-react'
