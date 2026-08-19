import { Home, Layers3, Settings, ShieldCheck } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useState } from 'react'

import { t } from '@/i18n/runtime'
import { Button, SectionNav, SidepanelShell, StatePanel } from '@/ui/components'
import { getDataPanelCopy } from '@/ui/data/copy'
import { getFeedPanelCopy } from '@/ui/feeds/copy'
import { getHomePanelCopy } from '@/ui/home/copy'
import { HomePanel } from '@/ui/home/HomePanel'
import { getReviewPanelCopy } from '@/ui/review/copy'
import { ReviewPanel } from '@/ui/review/ReviewPanel'
import { getRuleWorkbenchCopy } from '@/ui/rules/copy'
import { RuleWorkbench } from '@/ui/rules/RuleWorkbench'
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

type PanelSection = 'home' | 'rules' | 'review' | 'feeds' | 'data' | 'settings'

type PanelDestination = Extract<
  PanelSection,
  'home' | 'rules' | 'review' | 'settings'
>

export const App = () => {
  const ruleProfile = useRuleProfile()
  const [section, setSection] = useState<PanelSection>('home')
  const retryProfile = () => {
    void ruleProfile.load()
  }
  const openData = () => {
    setSection('data')
  }
  const openRules = () => {
    setSection('rules')
  }
  const openFeeds = () => {
    setSection('feeds')
  }
  const openSettings = () => {
    setSection('settings')
  }
  const openDestination = (destination: PanelDestination) => {
    setSection(destination)
  }
  const status =
    ruleProfile.state.status === 'loading'
      ? ('loading' as const)
      : ruleProfile.state.status === 'error'
        ? ('error' as const)
        : ('ready' as const)
  const statusLabel =
    status === 'loading'
      ? t('panelStatusLoading')
      : status === 'error'
        ? t('panelStatusError')
        : t('panelStatusReady')
  let content: ReactNode
  let navigation: ReactNode

  if (ruleProfile.state.status === 'loading') {
    content = loadingPanel
  } else if (ruleProfile.state.status === 'error') {
    content = (
      <StatePanel
        description={t('panelErrorDescription')}
        eyebrow={t('panelErrorEyebrow')}
        primaryAction={
          <Button
            disabled={ruleProfile.pending}
            onClick={retryProfile}
            size="full"
          >
            {t('panelRetryAction')}
          </Button>
        }
        state="error"
        title={t('panelErrorTitle')}
      />
    )
  } else if (section === 'data') {
    content = (
      <Suspense fallback={loadingPanel}>
        <DataPanel
          copy={getDataPanelCopy()}
          database={ruleProfile.database}
          diagnostics={ruleProfile.diagnostics}
          onBack={openSettings}
          onProfileChanged={ruleProfile.load}
        />
      </Suspense>
    )
  } else if (section === 'settings') {
    content = (
      <Suspense fallback={loadingPanel}>
        <SettingsPanel
          copy={getSettingsPanelCopy()}
          onOpenData={openData}
          onOpenFeeds={openFeeds}
          onProfileChanged={ruleProfile.refresh}
        />
      </Suspense>
    )
  } else if (section === 'feeds') {
    content = (
      <Suspense fallback={loadingPanel}>
        <FeedPanel
          copy={getFeedPanelCopy()}
          database={ruleProfile.database}
          onProfileChanged={ruleProfile.refresh}
        />
      </Suspense>
    )
  } else if (section === 'review') {
    content = (
      <ReviewPanel
        copy={getReviewPanelCopy()}
        database={ruleProfile.database}
      />
    )
  } else if (section === 'home') {
    content = (
      <HomePanel
        copy={getHomePanelCopy()}
        onOpenRules={openRules}
        profile={ruleProfile.state.profile}
      />
    )
  } else {
    content = (
      <RuleWorkbench
        copy={getRuleWorkbenchCopy()}
        onOpenData={openData}
        onRemove={ruleProfile.removeRule}
        onSave={ruleProfile.saveRule}
        pending={ruleProfile.pending}
        profile={ruleProfile.state.profile}
      />
    )
  }

  if (ruleProfile.state.status === 'ready') {
    const navigationSection: PanelDestination = [
      'settings',
      'feeds',
      'data'
    ].includes(section)
      ? 'settings'
      : (section as PanelDestination)
    navigation = (
      <SectionNav
        ariaLabel={t('panelNavigationLabel')}
        items={[
          {
            value: 'home',
            label: t('panelHomeNavigation'),
            icon: Home
          },
          {
            value: 'rules',
            label: t('panelRulesNavigation'),
            icon: ShieldCheck
          },
          {
            value: 'review',
            label: t('panelReviewNavigation'),
            icon: Layers3
          },
          {
            value: 'settings',
            label: t('panelSettingsNavigation'),
            icon: Settings
          }
        ]}
        onChange={openDestination}
        value={navigationSection}
        variant="primary"
      />
    )
    content = <div className="panel-view">{content}</div>
  }

  return (
    <SidepanelShell
      footer={t('panelFooterLocal')}
      navigation={navigation}
      productName={t('extensionName')}
      status={status}
      statusLabel={statusLabel}
    >
      {content}
    </SidepanelShell>
  )
}
