// biome-ignore-all lint/performance/noJsxPropsBind: controlled model fields need the current draft and item scope.
import type {
  ChangeEvent,
  Dispatch,
  SetStateAction,
  SyntheticEvent
} from 'react'

import { MODEL_TASK_VALUES, type ModelTask } from '@/ai/models/contracts'
import type { SettingsRuntimeSnapshot } from '@/application/settings/runtime-contracts'
import type { ContentLensSettings } from '@/core/settings'
import {
  Button,
  Combobox,
  DataList,
  Disclosure,
  Field,
  SelectField,
  Surface,
  ToggleField
} from '@/ui/components'
import {
  getProviderExecutionLabel,
  getTaskLabel,
  type SettingsPanelCopy
} from '@/ui/settings/copy'
import {
  modelsForTask,
  routeValue,
  updateGlobalFallback,
  updateGlobalFallbackPolicy,
  updateGlobalRoute
} from '@/ui/settings/model'
import { RouteAdvancedFields } from '@/ui/settings/RouteAdvancedFields'
import { RoutingBudgetFields } from '@/ui/settings/RoutingBudgetFields'
import { modelOptions, selectionValue } from '@/ui/settings/route-options'

export type ModelRoutingSettingsProps = {
  advancedMode: boolean
  copy: SettingsPanelCopy
  draft: ContentLensSettings
  modelId: string
  modelName: string
  modelProviderId: string
  modelTasks: readonly ModelTask[]
  onAddModel: (event: SyntheticEvent<HTMLFormElement>) => void
  onToggleTask: (task: ModelTask, checked: boolean) => void
  pending: boolean
  setDraft: Dispatch<SetStateAction<ContentLensSettings | undefined>>
  setModelFormDirty: (dirty: boolean) => void
  setModelId: (modelId: string) => void
  setModelName: (modelName: string) => void
  setModelProviderId: (providerConfigId: string) => void
  snapshot: SettingsRuntimeSnapshot
  updateDraft: (
    apply: (current: ContentLensSettings) => ContentLensSettings
  ) => void
}

export const ModelRoutingSettings = ({
  advancedMode,
  copy,
  draft,
  modelId,
  modelName,
  modelProviderId,
  modelTasks,
  onAddModel,
  onToggleTask,
  pending,
  setDraft,
  setModelFormDirty,
  setModelId,
  setModelName,
  setModelProviderId,
  snapshot,
  updateDraft
}: ModelRoutingSettingsProps) => {
  const providerOptions = snapshot.providers.providers
    .filter(({ status }) => status !== 'revoked')
    .map(provider => ({
      value: provider.providerConfigId,
      label: provider.displayName
    }))
  return (
    <div className="settings-stack">
      <Surface>
        <form className="settings-form" onSubmit={onAddModel}>
          <h3>{copy.addModelAction}</h3>
          <SelectField
            label={copy.modelProviderLabel}
            onChange={event => {
              setModelFormDirty(true)
              setModelProviderId(event.currentTarget.value)
            }}
            options={providerOptions}
            value={modelProviderId}
          />
          <Field
            label={copy.modelIdLabel}
            onChange={event => {
              setModelFormDirty(true)
              setModelId(event.currentTarget.value)
            }}
            required
            value={modelId}
          />
          <Field
            label={copy.modelDisplayLabel}
            onChange={event => {
              setModelFormDirty(true)
              setModelName(event.currentTarget.value)
            }}
            required
            value={modelName}
          />
          <fieldset className="settings-task-grid">
            <legend>{copy.modelTasksLabel}</legend>
            {MODEL_TASK_VALUES.map(task => (
              <ToggleField
                checked={modelTasks.includes(task)}
                key={task}
                label={getTaskLabel(task)}
                onChange={checked => onToggleTask(task, checked)}
              />
            ))}
          </fieldset>
          <Button
            disabled={pending || modelTasks.length === 0}
            type="submit"
            variant="secondary"
          >
            {copy.addModelAction}
          </Button>
        </form>
      </Surface>
      <Surface>
        <div className="settings-form">
          <h3>{copy.modelCatalogTitle}</h3>
          {snapshot.providers.models.length === 0 ? (
            <p className="settings-muted">{copy.modelsEmpty}</p>
          ) : (
            <div className="settings-stack">
              {snapshot.providers.models.map(model => {
                const provider = snapshot.providers.providers.find(
                  candidate =>
                    candidate.providerConfigId === model.providerConfigId
                )
                const modalities = [
                  ...new Set(
                    model.capabilities.flatMap(
                      capability => capability.modalities
                    )
                  )
                ]
                const languages = [
                  ...new Set(
                    model.capabilities.flatMap(
                      capability => capability.languages
                    )
                  )
                ]
                const verification = model.capabilities.some(
                  ({ evidence }) => evidence === 'benchmark-accepted'
                )
                  ? copy.modelVerificationBenchmark
                  : model.capabilities.some(
                        ({ evidence }) => evidence === 'probe-verified'
                      )
                    ? copy.modelVerificationProbe
                    : copy.modelVerificationDeclared
                const status =
                  model.status === 'available'
                    ? copy.modelCatalogStatusAvailable
                    : model.status === 'unavailable'
                      ? copy.modelCatalogStatusUnavailable
                      : copy.modelCatalogStatusInvalid
                return (
                  <Surface key={routeValue(model)} tone="subtle">
                    <div className="settings-form">
                      <h4>{model.displayName}</h4>
                      <DataList
                        items={[
                          {
                            term: copy.modelProviderNameLabel,
                            description: provider?.displayName ?? (
                              <code>{model.providerConfigId}</code>
                            )
                          },
                          {
                            term: copy.modelIdLabel,
                            description: <code>{model.modelId}</code>
                          },
                          {
                            term: copy.modelDeclaredVersionLabel,
                            description: model.declaredVersion ? (
                              <code>{model.declaredVersion}</code>
                            ) : (
                              copy.modelVersionUnknown
                            )
                          },
                          {
                            term: copy.executionLabel,
                            description: getProviderExecutionLabel(
                              model.executionKind
                            )
                          },
                          {
                            term: copy.modelTasksLabel,
                            description: model.capabilities
                              .map(({ task }) => getTaskLabel(task))
                              .join(', ')
                          },
                          {
                            term: copy.modelModalitiesLabel,
                            description: modalities
                              .map(modality =>
                                modality === 'image'
                                  ? copy.modelModalityImage
                                  : copy.modelModalityText
                              )
                              .join(', ')
                          },
                          {
                            term: copy.modelLanguagesLabel,
                            description: languages.join(', ')
                          },
                          {
                            term: copy.modelInputLimitLabel,
                            description:
                              model.capabilities.length > 0 ? (
                                <code>
                                  {Math.max(
                                    ...model.capabilities.map(
                                      ({ maxInputBytes }) => maxInputBytes
                                    )
                                  ).toLocaleString()}
                                </code>
                              ) : (
                                copy.modelVersionUnknown
                              )
                          },
                          {
                            term: copy.modelOutputLimitLabel,
                            description:
                              model.capabilities.length > 0 ? (
                                <code>
                                  {Math.max(
                                    ...model.capabilities.map(
                                      ({ maxOutputBytes }) => maxOutputBytes
                                    )
                                  ).toLocaleString()}
                                </code>
                              ) : (
                                copy.modelVersionUnknown
                              )
                          },
                          {
                            term: copy.modelVerificationLabel,
                            description: verification
                          },
                          {
                            term: copy.modelCatalogStatusLabel,
                            description: status
                          },
                          {
                            term: copy.modelLastCheckedLabel,
                            description: model.lastCheckedAt ? (
                              <code>{model.lastCheckedAt}</code>
                            ) : (
                              copy.modelVersionUnknown
                            )
                          },
                          ...(model.pricing
                            ? [
                                {
                                  term: copy.modelInputPriceLabel,
                                  description: (
                                    <code>{`${model.pricing.currency} ${model.pricing.inputPrice.toLocaleString()} / 1M`}</code>
                                  )
                                },
                                {
                                  term: copy.modelOutputPriceLabel,
                                  description: (
                                    <code>{`${model.pricing.currency} ${model.pricing.outputPrice.toLocaleString()} / 1M`}</code>
                                  )
                                },
                                {
                                  term: copy.modelPriceSourceLabel,
                                  description: (
                                    <span>
                                      <code>{model.pricing.sourceUrl}</code>
                                      {' · '}
                                      <code>{model.pricing.verifiedAt}</code>
                                    </span>
                                  )
                                }
                              ]
                            : [])
                        ]}
                      />
                    </div>
                  </Surface>
                )
              })}
            </div>
          )}
        </div>
      </Surface>
      <Surface>
        <div className="settings-form">
          <h3>{copy.globalRoutesTitle}</h3>
          <p className="settings-muted">{copy.globalRoutesBody}</p>
          {snapshot.providers.models.length === 0 ? (
            <p className="settings-muted">{copy.modelsEmpty}</p>
          ) : null}
          {MODEL_TASK_VALUES.map(task => {
            const route = draft.routing.globalRoutes[task]
            const options = modelOptions(
              snapshot.providers.models,
              task,
              copy.disabledOption
            )
            const props = {
              label: getTaskLabel(task),
              onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                const value = event.currentTarget.value
                setDraft(current =>
                  current ? updateGlobalRoute(current, task, value) : current
                )
              },
              options,
              value: selectionValue(draft.routing.globalRoutes[task], false)
            }
            const selector =
              modelsForTask(snapshot.providers.models, task).length > 8 ? (
                <Combobox {...props} searchLabel={copy.modelSearchLabel} />
              ) : (
                <SelectField {...props} />
              )
            return (
              <div className="settings-form" key={task}>
                {selector}
                {advancedMode && route?.state === 'route' ? (
                  <Disclosure summary={copy.advancedRoutingSummary}>
                    <RouteAdvancedFields
                      copy={copy}
                      models={snapshot.providers.models}
                      onFallbackChange={(index, value) =>
                        updateDraft(current =>
                          updateGlobalFallback(current, task, index, value)
                        )
                      }
                      onPolicyChange={(key, enabled) =>
                        updateDraft(current =>
                          updateGlobalFallbackPolicy(
                            current,
                            task,
                            key,
                            enabled
                          )
                        )
                      }
                      route={route}
                      task={task}
                    />
                  </Disclosure>
                ) : null}
              </div>
            )
          })}
          {advancedMode ? (
            <Disclosure summary={copy.routingBudgetsSummary}>
              <RoutingBudgetFields
                copy={copy}
                onChange={budgets =>
                  updateDraft(current => ({
                    ...current,
                    routing: { ...current.routing, budgets }
                  }))
                }
                value={draft.routing.budgets}
              />
            </Disclosure>
          ) : null}
        </div>
      </Surface>
    </div>
  )
}
