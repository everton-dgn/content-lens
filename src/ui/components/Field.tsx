import { type InputHTMLAttributes, useId } from 'react'

export type FieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'aria-describedby' | 'aria-invalid' | 'className' | 'style'
> & {
  error?: string
  hint?: string
  label: string
}

export const Field = ({
  error,
  hint,
  id: providedId,
  label,
  ...props
}: FieldProps) => {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="cl-field" data-slot="field">
      <label className="cl-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        {...props}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="cl-field__control"
        id={id}
      />
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
