import { Circle } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { useId } from 'react'

export type ChoiceOption<Value extends string> = {
  description?: string
  label: string
  value: Value
}

export type ChoiceGroupProps<Value extends string> = {
  label: string
  name: string
  onChange: (value: Value) => void
  options: readonly ChoiceOption<Value>[]
  value: Value
}

export const ChoiceGroup = <Value extends string>({
  label,
  name,
  onChange,
  options,
  value
}: ChoiceGroupProps<Value>) => {
  const groupId = useId()
  const legendId = `${groupId}-legend`

  return (
    <fieldset className="cl-choice-group" data-slot="choice-group">
      <legend className="cl-choice-group__legend" id={legendId}>
        {label}
      </legend>
      <RadioGroupPrimitive.Root
        aria-labelledby={legendId}
        className="cl-choice-group__options"
        name={name}
        onValueChange={nextValue => onChange(nextValue as Value)}
        value={value}
      >
        {options.map((option, index) => {
          const labelId = `${groupId}-option-${index}-label`
          const descriptionId = option.description
            ? `${groupId}-option-${index}-description`
            : undefined

          return (
            <RadioGroupPrimitive.Item
              aria-describedby={descriptionId}
              aria-labelledby={labelId}
              className="cl-choice-group__option"
              key={option.value}
              value={option.value}
            >
              <span aria-hidden="true" className="cl-choice-group__radio">
                <RadioGroupPrimitive.Indicator asChild>
                  <Circle aria-hidden="true" />
                </RadioGroupPrimitive.Indicator>
              </span>
              <span className="cl-choice-group__copy">
                <strong id={labelId}>{option.label}</strong>
                {option.description ? (
                  <small id={descriptionId}>{option.description}</small>
                ) : null}
              </span>
            </RadioGroupPrimitive.Item>
          )
        })}
      </RadioGroupPrimitive.Root>
    </fieldset>
  )
}
