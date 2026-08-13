import { Check, ChevronDown } from 'lucide-react'
import { Select as SelectPrimitive } from 'radix-ui'
import { type SelectHTMLAttributes, useId, useRef } from 'react'

export type SelectOption = {
  disabled?: boolean
  label: string
  value: string
}

export type SelectFieldProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'aria-describedby' | 'aria-invalid' | 'className' | 'style'
> & {
  error?: string
  hint?: string
  label: string
  options: readonly SelectOption[]
}

export const SelectField = ({
  disabled,
  error,
  hint,
  id: providedId,
  label,
  options,
  value,
  ...props
}: SelectFieldProps) => {
  const generatedId = useId()
  const id = providedId ?? generatedId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const nativeRef = useRef<HTMLSelectElement>(null)
  const updateValue = (nextValue: string) => {
    const control = nativeRef.current
    if (!control) {
      return
    }
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value'
    )?.set
    valueSetter?.call(control, nextValue)
    control.dispatchEvent(new Event('change', { bubbles: true }))
  }

  return (
    <div className="cl-field" data-slot="select-field">
      <label className="cl-field__label" htmlFor={`${id}-trigger`}>
        {label}
      </label>
      <SelectPrimitive.Root
        disabled={disabled}
        onValueChange={updateValue}
        value={String(value ?? '')}
      >
        <SelectPrimitive.Trigger
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className="cl-field__control cl-select__trigger"
          id={`${id}-trigger`}
        >
          <SelectPrimitive.Value className="cl-select__value" />
          <SelectPrimitive.Icon asChild>
            <ChevronDown aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className="cl-select__content"
            position="popper"
            sideOffset={6}
          >
            <SelectPrimitive.Viewport className="cl-select__viewport">
              {options.map(option => (
                <SelectPrimitive.Item
                  className="cl-select__item"
                  disabled={option.disabled}
                  key={option.value}
                  value={option.value}
                >
                  <SelectPrimitive.ItemText>
                    {option.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="cl-select__indicator">
                    <Check aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      <label className="cl-visually-hidden" htmlFor={id}>
        {label}
      </label>
      <select
        {...props}
        aria-describedby={describedBy}
        aria-hidden="true"
        aria-invalid={error ? true : undefined}
        className="cl-visually-hidden"
        disabled={disabled}
        id={id}
        ref={nativeRef}
        tabIndex={-1}
        value={value}
      >
        {options.map(option => (
          <option
            disabled={option.disabled}
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
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
