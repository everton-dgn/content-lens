import type { SettingsRuntimeSnapshot } from '@/application/settings/runtime-contracts'
import { Button, Surface } from '@/ui/components'
import type { SettingsPanelCopy } from '@/ui/settings/copy'
import type { SettingsRuntimeClient } from '@/ui/settings/runtime'
import { SyncSettingsSection } from '@/ui/settings/SyncSettingsSection'

export type PrivacyDataSettingsProps = {
  copy: SettingsPanelCopy
  onOpenData?: () => void
  onRefresh: () => Promise<unknown>
  runtime: SettingsRuntimeClient
  snapshot: SettingsRuntimeSnapshot
}

export const PrivacyDataSettings = ({
  copy,
  onOpenData,
  onRefresh,
  runtime,
  snapshot
}: PrivacyDataSettingsProps) => (
  <div className="settings-stack">
    <Surface>
      <div className="settings-form">
        <h3>{copy.privacyDataTitle}</h3>
        <p className="settings-muted">{copy.privacyDataDescription}</p>
        {onOpenData ? (
          <Button onClick={onOpenData} variant="secondary">
            {copy.privacyDataAction}
          </Button>
        ) : null}
      </div>
    </Surface>
    <Surface>
      <SyncSettingsSection
        connection={snapshot.sync}
        conflict={snapshot.syncConflict}
        copy={copy}
        onRefresh={onRefresh}
        providers={snapshot.providers.providers}
        recoveries={snapshot.syncRecoveries}
        runtime={runtime}
      />
    </Surface>
  </div>
)
