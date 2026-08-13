import {
  type ChangeEvent,
  type InputHTMLAttributes,
  useId,
  useState
} from 'react'

export type FileFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'aria-describedby' | 'aria-labelledby' | 'className' | 'style' | 'type'
> & {
  actionLabel: string
  emptyLabel: string
  hint?: string
  label: string
}

export const FileField = ({
  actionLabel,
  emptyLabel,
  hint,
  id: providedId,
  label,
  onChange,
  ...props
}: FileFieldProps) => {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const labelId = `${id}-label`
  const actionId = `${id}-action`
  const hintId = hint ? `${id}-hint` : undefined
  const selectionId = `${id}-selection`
  const [selection, setSelection] = useState(emptyLabel)
  const describedBy = [hintId, selectionId].filter(Boolean).join(' ')
  const updateSelection = (event: ChangeEvent<HTMLInputElement>) => {
    setSelection(event.currentTarget.files?.[0]?.name ?? emptyLabel)
    onChange?.(event)
  }

  return (
    <div className="cl-file-field" data-slot="file-field">
      <span className="cl-file-field__label" id={labelId}>
        {label}
      </span>
      <label className="cl-file-field__picker">
        <Upload aria-hidden="true" />
        <span id={actionId}>{actionLabel}</span>
        <input
          {...props}
          aria-describedby={describedBy}
          aria-labelledby={`${actionId} ${labelId}`}
          id={id}
          onChange={updateSelection}
          type="file"
        />
      </label>
      <p
        aria-live="polite"
        className="cl-file-field__selection"
        id={selectionId}
      >
        {selection}
      </p>
      {hint ? (
        <p className="cl-file-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

import { Upload } from 'lucide-react'
