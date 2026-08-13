import type { ChangeEvent } from 'react'

import type {
  ModelDescriptor,
  ModelTask,
  PlatformRouteSelection
} from '@/ai/models/contracts'
import { Combobox, SelectField, SwitchField } from '@/ui/components'
import type { SettingsPanelCopy } from '@/ui/settings/copy'
import { modelsForTask, routeValue } from '@/ui/settings/model'

type RoutedSelection = Extract<PlatformRouteSelection, { state: 'route' }>
const fallbackSlots = [
  { index: 0, key: 'fallback-position-1' },
  { index: 1, key: 'fallback-position-2' },
  { index: 2, key: 'fallback-position-3' }
] as const

export type RouteAdvancedFieldsProps = {
  copy: SettingsPanelCopy
  models: readonly ModelDescriptor[]
  onFallbackChange(index: number, value: string): void
  onPolicyChange(
    key: 'allowCloudFallback' | 'allowHigherCostFallback',
    enabled: boolean
  ): void
  route: RoutedSelection
  task: ModelTask
}

export const RouteAdvancedFields = ({
  copy,
  models,
  onFallbackChange,
  onPolicyChange,
  route,
  task
}: RouteAdvancedFieldsProps) => {
  const eligible = modelsForTask(models, task)
  const displayedFallbacks = Math.min(3, route.fallbacks.length + 1)
  const modelByValue = new Map(models.map(model => [routeValue(model), model]))
  const orderedModels = [route.primary, ...route.fallbacks]
    .map(reference => modelByValue.get(routeValue(reference)))
    .filter((model): model is ModelDescriptor => Boolean(model))
  const changeCloudFallback = (checked: boolean) =>
    onPolicyChange('allowCloudFallback', checked)
  const changeHigherCostFallback = (checked: boolean) =>
    onPolicyChange('allowHigherCostFallback', checked)

  return (
    <div className="settings-stack">
      <div className="settings-form">
        <strong>{copy.fallbackOrderLabel}</strong>
        <ol className="settings-consent-list">
          {orderedModels.map(model => (
            <li key={routeValue(model)}>
              <span>{model.displayName}</span>
              <code>{model.providerConfigId}</code>
            </li>
          ))}
          <li>{copy.deterministicBaselineLabel}</li>
        </ol>
      </div>
      {fallbackSlots.slice(0, displayedFallbacks).map(slot => {
        const index = slot.index
        const current = route.fallbacks[index]
        const unavailableValues = new Set([
          routeValue(route.primary),
          ...route.fallbacks
            .filter((_reference, candidateIndex) => candidateIndex !== index)
            .map(routeValue)
        ])
        const options = [
          { value: 'disabled', label: copy.noFallbackOption },
          ...eligible
            .filter(
              model =>
                !unavailableValues.has(routeValue(model)) ||
                routeValue(model) === (current ? routeValue(current) : '')
            )
            .map(model => ({
              value: routeValue(model),
              label: `${model.displayName} · ${model.providerConfigId}`
            }))
        ]
        const props = {
          label: copy.fallbackPositionLabel(index + 1),
          onChange: (event: ChangeEvent<HTMLSelectElement>) =>
            onFallbackChange(index, event.currentTarget.value),
          options,
          value: current ? routeValue(current) : 'disabled'
        }
        return options.length > 9 ? (
          <Combobox
            {...props}
            key={slot.key}
            searchLabel={copy.modelSearchLabel}
          />
        ) : (
          <SelectField {...props} key={slot.key} />
        )
      })}
      <SwitchField
        checked={route.allowCloudFallback}
        description={copy.allowCloudFallbackDescription}
        label={copy.allowCloudFallbackLabel}
        onChange={changeCloudFallback}
      />
      <SwitchField
        checked={route.allowHigherCostFallback}
        description={copy.allowHigherCostFallbackDescription}
        label={copy.allowHigherCostFallbackLabel}
        onChange={changeHigherCostFallback}
      />
    </div>
  )
}
