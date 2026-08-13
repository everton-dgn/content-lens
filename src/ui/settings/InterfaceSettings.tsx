// biome-ignore-all lint/performance/noJsxPropsBind: controlled fields need the current draft.
import type { ContentLensSettings } from '@/core/settings'
import { SelectField, Surface, SwitchField } from '@/ui/components'
import type { SettingsPanelCopy } from '@/ui/settings/copy'

export type InterfaceSettingsProps = {
  copy: SettingsPanelCopy
  draft: ContentLensSettings
  updateDraft: (
    apply: (current: ContentLensSettings) => ContentLensSettings
  ) => void
}

export const InterfaceSettings = ({
  copy,
  draft,
  updateDraft
}: InterfaceSettingsProps) => (
  <Surface>
    <div className="settings-form">
      <h3>{copy.interfaceTitle}</h3>
      <SwitchField
        checked={draft.interface.advancedMode}
        description={copy.advancedDescription}
        label={copy.advancedLabel}
        onChange={advancedMode =>
          updateDraft(current => ({
            ...current,
            interface: { ...current.interface, advancedMode }
          }))
        }
      />
      <SelectField
        label={copy.colorLabel}
        onChange={event => {
          const colorMode = event.currentTarget
            .value as ContentLensSettings['interface']['colorMode']
          updateDraft(current => ({
            ...current,
            interface: { ...current.interface, colorMode }
          }))
        }}
        options={[
          { value: 'system', label: copy.colorSystem },
          { value: 'light', label: copy.colorLight },
          { value: 'dark', label: copy.colorDark }
        ]}
        value={draft.interface.colorMode}
      />
      <SelectField
        label={copy.localeLabel}
        onChange={event => {
          const locale = event.currentTarget
            .value as ContentLensSettings['interface']['locale']
          updateDraft(current => ({
            ...current,
            interface: { ...current.interface, locale }
          }))
        }}
        options={[
          { value: 'auto', label: copy.localeAuto },
          { value: 'en', label: copy.localeEnglish },
          { value: 'pt_BR', label: copy.localePortuguese },
          { value: 'es', label: copy.localeSpanish }
        ]}
        value={draft.interface.locale}
      />
    </div>
  </Surface>
)
