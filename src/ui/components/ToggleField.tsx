import { Check } from 'lucide-react'
import { Toggle as TogglePrimitive } from 'radix-ui'
import { type ChangeEvent, useId } from 'react'

export type ToggleFieldProps = {
  checked: boolean
  description?: string
  disabled?: boolean
  label: string
  name?: string
  onChange(checked: boolean): void
}

export const ToggleField = ({
  checked,
  description,
  disabled,
  label,
  name,
  onChange
}: ToggleFieldProps) => {
  const id = useId()
  const descriptionId = description ? `${id}-description` : undefined
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.currentTarget.checked)
  }

  return (
    <label className="cl-toggle-field" data-slot="toggle-field" htmlFor={id}>
      <input
        aria-hidden="true"
        aria-describedby={descriptionId}
        checked={checked}
        className="cl-visually-hidden"
        disabled={disabled}
        id={id}
        name={name}
        onChange={handleChange}
        tabIndex={-1}
        type="checkbox"
      />
      <TogglePrimitive.Root
        aria-label={label}
        className="cl-toggle-field__control"
        disabled={disabled}
        onPressedChange={onChange}
        pressed={checked}
      >
        <Check aria-hidden="true" />
      </TogglePrimitive.Root>
      <span>
        <strong>{label}</strong>
        {description ? <small id={descriptionId}>{description}</small> : null}
      </span>
    </label>
  )
}
