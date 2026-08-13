import { Button, Surface } from '@/ui/components'
import type { SettingsPanelCopy } from '@/ui/settings/copy'

export type DiagnosticsSettingsProps = {
  copy: SettingsPanelCopy
  onOpenData?: () => void
}

export const DiagnosticsSettings = ({
  copy,
  onOpenData
}: DiagnosticsSettingsProps) => (
  <Surface>
    <div className="settings-form">
      <h3>{copy.diagnosticsTitle}</h3>
      <p className="settings-muted">{copy.diagnosticsDescription}</p>
      {onOpenData ? (
        <Button onClick={onOpenData} variant="secondary">
          {copy.diagnosticsAction}
        </Button>
      ) : null}
    </div>
  </Surface>
)
