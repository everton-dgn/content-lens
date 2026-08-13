import { Switch as SwitchPrimitive } from 'radix-ui'
import { useId } from 'react'

export type SwitchFieldProps = {
  checked: boolean
  description?: string
  disabled?: boolean
  label: string
  name?: string
  onChange(checked: boolean): void
}

export const SwitchField = ({
  checked,
  description,
  disabled,
  label,
  name,
  onChange
}: SwitchFieldProps) => {
  const id = useId()
  const labelId = `${id}-label`
  const descriptionId = description ? `${id}-description` : undefined

  return (
    <SwitchPrimitive.Root
      aria-describedby={descriptionId}
      aria-labelledby={labelId}
      checked={checked}
      className="cl-switch-field"
      data-slot="switch-field"
      disabled={disabled}
      id={id}
      name={name}
      onCheckedChange={onChange}
    >
      <span className="cl-switch-field__copy">
        <strong id={labelId}>{label}</strong>
        {description ? <small id={descriptionId}>{description}</small> : null}
      </span>
      <span aria-hidden="true" className="cl-switch-field__control">
        <span className="cl-switch-field__track">
          <SwitchPrimitive.Thumb className="cl-switch-field__thumb" />
        </span>
      </span>
    </SwitchPrimitive.Root>
  )
}
