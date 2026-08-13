// biome-ignore-all lint/performance/noJsxPropsBind: each controlled field updates one named budget value.
import type { BudgetPolicy } from '@/ai/models/contracts'
import { Field, SelectField, SwitchField } from '@/ui/components'
import type { SettingsPanelCopy } from '@/ui/settings/copy'

const numberOptions = (values: readonly number[]) =>
  values.map(value => ({ value: String(value), label: String(value) }))

export type RoutingBudgetFieldsProps = {
  copy: SettingsPanelCopy
  onChange(value: BudgetPolicy): void
  value: BudgetPolicy
}

export const RoutingBudgetFields = ({
  copy,
  onChange,
  value
}: RoutingBudgetFieldsProps) => {
  const updateNumber = (
    key:
      | 'maxConcurrentGlobal'
      | 'maxConcurrentByProvider'
      | 'requestsPerMinuteByProvider'
      | 'requestsPerDayByProvider',
    next: string
  ) => onChange({ ...value, [key]: Number(next) })

  return (
    <div className="settings-stack">
      <SelectField
        label={copy.maxConcurrentGlobalLabel}
        onChange={event =>
          updateNumber('maxConcurrentGlobal', event.currentTarget.value)
        }
        options={numberOptions([1, 2, 4, 8])}
        value={String(value.maxConcurrentGlobal)}
      />
      <SelectField
        label={copy.maxConcurrentProviderLabel}
        onChange={event =>
          updateNumber('maxConcurrentByProvider', event.currentTarget.value)
        }
        options={numberOptions([1, 2, 3, 4])}
        value={String(value.maxConcurrentByProvider)}
      />
      <SelectField
        label={copy.requestsPerMinuteLabel}
        onChange={event =>
          updateNumber('requestsPerMinuteByProvider', event.currentTarget.value)
        }
        options={numberOptions([10, 30, 60, 120, 300, 600])}
        value={String(value.requestsPerMinuteByProvider)}
      />
      <SelectField
        label={copy.requestsPerDayLabel}
        onChange={event =>
          updateNumber('requestsPerDayByProvider', event.currentTarget.value)
        }
        options={numberOptions([100, 500, 1_000, 5_000, 10_000, 100_000])}
        value={String(value.requestsPerDayByProvider)}
      />
      <SwitchField
        checked={value.monetaryBudget.enabled}
        description={copy.monetaryBudgetDescription}
        label={copy.monetaryBudgetLabel}
        onChange={enabled =>
          onChange({
            ...value,
            monetaryBudget: { ...value.monetaryBudget, enabled }
          })
        }
      />
      {value.monetaryBudget.enabled ? (
        <>
          <Field
            label={copy.monetaryLimitLabel}
            min={0}
            onChange={event => {
              if (Number.isFinite(event.currentTarget.valueAsNumber)) {
                onChange({
                  ...value,
                  monetaryBudget: {
                    ...value.monetaryBudget,
                    limit: event.currentTarget.valueAsNumber
                  }
                })
              }
            }}
            step="0.01"
            type="number"
            value={value.monetaryBudget.limit}
          />
          <Field
            label={copy.monetaryCurrencyLabel}
            maxLength={8}
            onChange={event =>
              onChange({
                ...value,
                monetaryBudget: {
                  ...value.monetaryBudget,
                  currency: event.currentTarget.value.toUpperCase()
                }
              })
            }
            required
            value={value.monetaryBudget.currency}
          />
          <SelectField
            label={copy.priceMaxAgeLabel}
            onChange={event =>
              onChange({
                ...value,
                monetaryBudget: {
                  ...value.monetaryBudget,
                  priceMaxAgeHours: Number(event.currentTarget.value)
                }
              })
            }
            options={[1, 6, 12, 24, 48, 168].map(hours => ({
              value: String(hours),
              label: copy.hoursLabel(hours)
            }))}
            value={String(value.monetaryBudget.priceMaxAgeHours)}
          />
        </>
      ) : null}
    </div>
  )
}
