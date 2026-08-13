// biome-ignore-all lint/performance/noJsxPropsBind: controlled platform fields need the current draft and item scope.
import type { ChangeEvent } from 'react'

import { MODEL_TASK_VALUES } from '@/ai/models/contracts'
import { nativeFeedbackAddenda } from '@/application/native-feedback/registry'
import type { SettingsRuntimeSnapshot } from '@/application/settings/runtime-contracts'
import { PLATFORM_VALUES, type Platform } from '@/core/content/contracts'
import { PLATFORM_SURFACES } from '@/core/content/surfaces'
import type { ContentLensSettings } from '@/core/settings'
import {
  Button,
  Combobox,
  Disclosure,
  Notice,
  SelectField,
  Surface,
  ToggleField
} from '@/ui/components'
import {
  getPermissionStateLabel,
  getPlatformLabel,
  getPlatformSurfaceLabel,
  getTaskLabel,
  type SettingsPanelCopy
} from '@/ui/settings/copy'
import {
  effectiveRoute,
  modelsForTask,
  routeValue,
  updatePlatformFallback,
  updatePlatformFallbackPolicy,
  updatePlatformRoute
} from '@/ui/settings/model'
import { RouteAdvancedFields } from '@/ui/settings/RouteAdvancedFields'
import { modelOptions, selectionValue } from '@/ui/settings/route-options'

export type PlatformSettingsProps = {
  advancedMode: boolean
  copy: SettingsPanelCopy
  draft: ContentLensSettings
  onRequestPermission: () => void
  pending: boolean
  selectedPlatform: Platform
  setSelectedPlatform: (platform: Platform) => void
  snapshot: SettingsRuntimeSnapshot
  updateDraft: (
    apply: (current: ContentLensSettings) => ContentLensSettings
  ) => void
}

export const PlatformSettings = ({
  advancedMode,
  copy,
  draft,
  onRequestPermission,
  pending,
  selectedPlatform,
  setSelectedPlatform,
  snapshot,
  updateDraft
}: PlatformSettingsProps) => {
  const platformSettings = draft.platforms[selectedPlatform]
  const nativeFeedbackAvailable =
    nativeFeedbackAddenda[selectedPlatform]?.capabilities.some(
      capability =>
        capability.state === 'supported' && capability.lastLiveSmokeAt !== null
    ) ?? false
  const vision = effectiveRoute(
    draft,
    selectedPlatform,
    'classification-vision'
  )
  const text = effectiveRoute(draft, selectedPlatform, 'classification-text')
  const textModel =
    text.state === 'route'
      ? snapshot.providers.models.find(
          candidate => routeValue(candidate) === routeValue(text.primary)
        )
      : undefined
  const textOnly =
    vision.state === 'disabled' &&
    textModel?.capabilities.every(
      capability => !capability.modalities.includes('image')
    )
  return (
    <div className="settings-overview">
      <div className="settings-stack">
        <Surface>
          <div className="settings-form">
            <SelectField
              label={copy.platformSelectLabel}
              onChange={event => {
                const platform = PLATFORM_VALUES.find(
                  candidate => candidate === event.currentTarget.value
                )
                if (platform) {
                  setSelectedPlatform(platform)
                }
              }}
              options={PLATFORM_VALUES.map(platform => ({
                value: platform,
                label: getPlatformLabel(platform)
              }))}
              value={selectedPlatform}
            />
            <SelectField
              label={copy.platformActivationLabel}
              onChange={event => {
                const state = event.currentTarget
                  .value as typeof platformSettings.state
                updateDraft(current => ({
                  ...current,
                  platforms: {
                    ...current.platforms,
                    [selectedPlatform]: {
                      ...current.platforms[selectedPlatform],
                      state
                    }
                  }
                }))
              }}
              options={[
                { value: 'enabled', label: copy.platformEnabled },
                { value: 'paused', label: copy.platformPaused },
                { value: 'disabled', label: copy.platformDisabled }
              ]}
              value={platformSettings.state}
            />
          </div>
        </Surface>
        <Surface>
          <div className="settings-form">
            <h3>{copy.nativeFeedbackTitle}</h3>
            <Notice
              body={
                nativeFeedbackAvailable
                  ? copy.nativeFeedbackAvailableBody
                  : copy.nativeFeedbackUnavailableBody
              }
              title={
                nativeFeedbackAvailable
                  ? copy.nativeFeedbackAvailableTitle
                  : copy.nativeFeedbackUnavailableTitle
              }
              tone={nativeFeedbackAvailable ? 'info' : 'degraded'}
            />
            <ToggleField
              checked={platformSettings.nativeFeedbackEnabled}
              disabled={!nativeFeedbackAvailable}
              label={copy.nativeFeedbackToggleLabel}
              onChange={nativeFeedbackEnabled =>
                updateDraft(current => ({
                  ...current,
                  platforms: {
                    ...current.platforms,
                    [selectedPlatform]: {
                      ...current.platforms[selectedPlatform],
                      nativeFeedbackEnabled
                    }
                  }
                }))
              }
            />
          </div>
        </Surface>
        <Surface>
          <div className="settings-form">
            <h3>{copy.surfacesTitle}</h3>
            <div className="settings-task-grid">
              {PLATFORM_SURFACES[selectedPlatform].map(surface => {
                const key =
                  `${selectedPlatform}:${surface}` as keyof typeof platformSettings.surfaces
                return (
                  <ToggleField
                    checked={platformSettings.surfaces[key] ?? false}
                    key={key}
                    label={getPlatformSurfaceLabel(key)}
                    onChange={checked =>
                      updateDraft(current => ({
                        ...current,
                        platforms: {
                          ...current.platforms,
                          [selectedPlatform]: {
                            ...current.platforms[selectedPlatform],
                            surfaces: {
                              ...current.platforms[selectedPlatform].surfaces,
                              [key]: checked
                            }
                          }
                        }
                      }))
                    }
                  />
                )
              })}
            </div>
          </div>
        </Surface>
        <Surface>
          <div className="settings-form">
            <h3>{copy.platformRoutingTitle}</h3>
            {MODEL_TASK_VALUES.map(task => {
              const override =
                draft.routing.platformOverrides[selectedPlatform]?.[task]
              const options = modelOptions(
                snapshot.providers.models,
                task,
                copy.disabledOption,
                copy.inheritOption
              )
              const props = {
                label: getTaskLabel(task),
                onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                  const value = event.currentTarget.value
                  updateDraft(current =>
                    updatePlatformRoute(current, selectedPlatform, task, value)
                  )
                },
                options,
                value: selectionValue(override, true)
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
                  {advancedMode && override?.state === 'route' ? (
                    <Disclosure summary={copy.advancedRoutingSummary}>
                      <RouteAdvancedFields
                        copy={copy}
                        models={snapshot.providers.models}
                        onFallbackChange={(index, value) =>
                          updateDraft(current =>
                            updatePlatformFallback(
                              current,
                              selectedPlatform,
                              task,
                              index,
                              value
                            )
                          )
                        }
                        onPolicyChange={(key, enabled) =>
                          updateDraft(current =>
                            updatePlatformFallbackPolicy(
                              current,
                              selectedPlatform,
                              task,
                              key,
                              enabled
                            )
                          )
                        }
                        route={override}
                        task={task}
                      />
                    </Disclosure>
                  ) : null}
                </div>
              )
            })}
            {textOnly ? (
              <Notice
                body={copy.textOnlyBody}
                title={copy.textOnlyTitle}
                tone="degraded"
              />
            ) : null}
          </div>
        </Surface>
      </div>
      <aside className="settings-rail">
        {selectedPlatform !== 'rss' ? (
          <Surface>
            <div className="settings-form">
              <Notice
                body={copy.permissionBody}
                title={`${copy.providerStatusLabel}: ${getPermissionStateLabel(platformSettings.permissionState)}`}
                tone="info"
              />
              <Button
                disabled={pending}
                onClick={onRequestPermission}
                variant="secondary"
              >
                {copy.permissionRequestAction}
              </Button>
            </div>
          </Surface>
        ) : null}
      </aside>
    </div>
  )
}
