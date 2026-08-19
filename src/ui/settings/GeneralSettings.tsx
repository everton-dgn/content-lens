import { ChevronRight } from 'lucide-react'

import type { SettingsRuntimeSnapshot } from '@/application/settings/runtime-contracts'
import type { ContentLensSettings } from '@/core/settings'
import { Button, DataList, Surface } from '@/ui/components'
import type { SettingsPanelCopy } from '@/ui/settings/copy'

export type GeneralSettingsProps = {
  copy: SettingsPanelCopy
  draft: ContentLensSettings
  onOpenData?: () => void
  onOpenFeeds?: () => void
  snapshot: SettingsRuntimeSnapshot
}

const localeLabelFor = (
  copy: SettingsPanelCopy,
  locale: ContentLensSettings['interface']['locale']
) => {
  if (locale === 'en') {
    return copy.localeEnglish
  }
  if (locale === 'pt_BR') {
    return copy.localePortuguese
  }
  if (locale === 'es') {
    return copy.localeSpanish
  }
  return copy.localeAuto
}

export const GeneralSettings = ({
  copy,
  draft,
  onOpenData,
  onOpenFeeds,
  snapshot
}: GeneralSettingsProps) => (
  <div className="settings-overview">
    <Surface className="settings-summary-card" elevation="raised">
      <div className="settings-form settings-summary">
        <div className="settings-summary__heading">
          <h3>{copy.generalTitle}</h3>
          <p className="settings-muted">{copy.generalDescription}</p>
        </div>
        <DataList
          items={[
            {
              term: copy.localeLabel,
              description: localeLabelFor(copy, draft.interface.locale)
            },
            {
              term: copy.providersTitle,
              description: copy.generalProviderCount(
                snapshot.providers.providers.length
              )
            },
            {
              term: copy.modelsTitle,
              description: copy.generalModelCount(
                snapshot.providers.models.length
              )
            },
            {
              term: copy.advancedLabel,
              description: draft.interface.advancedMode
                ? copy.platformEnabled
                : copy.platformDisabled
            }
          ]}
          layout="summary"
        />
      </div>
    </Surface>
    {onOpenData || onOpenFeeds ? (
      <Surface>
        <div className="settings-form">
          <h3>{copy.shortcutsTitle}</h3>
          <p className="settings-muted">{copy.shortcutsDescription}</p>
          <div className="settings-shortcuts">
            {onOpenFeeds ? (
              <Button onClick={onOpenFeeds} variant="secondary">
                <span>{copy.feedsShortcutAction}</span>
                <ChevronRight aria-hidden="true" />
              </Button>
            ) : null}
            {onOpenData ? (
              <Button onClick={onOpenData} variant="secondary">
                <span>{copy.dataShortcutAction}</span>
                <ChevronRight aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
      </Surface>
    ) : null}
  </div>
)
