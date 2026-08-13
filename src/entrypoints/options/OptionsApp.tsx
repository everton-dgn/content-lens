import { lazy, type ReactNode, Suspense, useState } from 'react'

import { t } from '@/i18n/runtime'
import { Button, SidepanelShell, StatePanel } from '@/ui/components'
import { getDataPanelCopy } from '@/ui/data/copy'
import { getFeedPanelCopy } from '@/ui/feeds/copy'
import { useRuleProfile } from '@/ui/rules/useRuleProfile'
import { getSettingsPanelCopy } from '@/ui/settings/copy'

const DataPanel = lazy(() =>
  import('@/ui/data/DataPanel').then(({ DataPanel }) => ({
    default: DataPanel
  }))
)
const FeedPanel = lazy(() =>
  import('@/ui/feeds/FeedPanel').then(({ FeedPanel }) => ({
    default: FeedPanel
  }))
)
const SettingsPanel = lazy(() =>
  import('@/ui/settings/SettingsPanel').then(({ SettingsPanel }) => ({
    default: SettingsPanel
  }))
)

const loadingPanel = (
  <StatePanel
    description={t('panelLoadingDescription')}
    eyebrow={t('panelLoadingEyebrow')}
    state="loading"
    title={t('panelLoadingTitle')}
  />
)

export const OptionsApp = () => {
  const profile = useRuleProfile()
  const [view, setView] = useState<'settings' | 'feeds' | 'data'>('settings')
  const openSettings = () => setView('settings')
  const openData = () => setView('data')
  const openFeeds = () => setView('feeds')
  let content: ReactNode

  if (profile.state.status === 'loading') {
    content = loadingPanel
  } else if (profile.state.status === 'error') {
    content = (
      <StatePanel
        description={t('panelErrorDescription')}
        eyebrow={t('panelErrorEyebrow')}
        primaryAction={
          <Button onClick={profile.load}>{t('panelRetryAction')}</Button>
        }
        state="error"
        title={t('panelErrorTitle')}
      />
    )
  } else if (view === 'data') {
    content = (
      <Suspense fallback={loadingPanel}>
        <DataPanel
          copy={getDataPanelCopy()}
          database={profile.database}
          diagnostics={profile.diagnostics}
          onBack={openSettings}
          onProfileChanged={profile.load}
        />
      </Suspense>
    )
  } else if (view === 'feeds') {
    content = (
      <Suspense fallback={loadingPanel}>
        <FeedPanel
          backLabel={getDataPanelCopy().backAction}
          copy={getFeedPanelCopy()}
          database={profile.database}
          onBack={openSettings}
          onProfileChanged={profile.refresh}
        />
      </Suspense>
    )
  } else {
    content = (
      <Suspense fallback={loadingPanel}>
        <SettingsPanel
          copy={getSettingsPanelCopy()}
          onOpenData={openData}
          onOpenFeeds={openFeeds}
          onProfileChanged={profile.refresh}
        />
      </Suspense>
    )
  }

  return (
    <SidepanelShell
      footer={t('panelFooterLocal')}
      productName={t('extensionName')}
      status={
        profile.state.status === 'error'
          ? 'error'
          : profile.state.status === 'loading'
            ? 'loading'
            : 'ready'
      }
      statusLabel={
        profile.state.status === 'error'
          ? t('panelStatusError')
          : profile.state.status === 'loading'
            ? t('panelStatusLoading')
            : t('panelStatusReady')
      }
    >
      {content}
    </SidepanelShell>
  )
}
