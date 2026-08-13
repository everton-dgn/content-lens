import type { ModelDescriptor, ModelTask } from '@/ai/models/contracts'
import {
  type effectiveRoute,
  modelsForTask,
  routeValue
} from '@/ui/settings/model'

export const selectionValue = (
  selection: ReturnType<typeof effectiveRoute> | undefined,
  inherited: boolean
) => {
  if (!selection || selection.state === 'inherit') {
    return inherited ? 'inherit' : 'disabled'
  }
  return selection.state === 'route'
    ? routeValue(selection.primary)
    : 'disabled'
}

export const modelOptions = (
  models: readonly ModelDescriptor[],
  task: ModelTask,
  disabledLabel: string,
  inheritLabel?: string
) => [
  ...(inheritLabel ? [{ value: 'inherit', label: inheritLabel }] : []),
  { value: 'disabled', label: disabledLabel },
  ...modelsForTask(models, task).map(model => ({
    value: routeValue(model),
    label: `${model.displayName} · ${model.providerConfigId}`
  }))
]
