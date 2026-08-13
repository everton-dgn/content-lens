import { ArrowRight, ShieldCheck } from 'lucide-react'

import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'
import { Button, Surface } from '@/ui/components'
import type { HomePanelCopy } from '@/ui/home/copy'

export type HomePanelProps = {
  copy: HomePanelCopy
  onOpenRules(): void
  profile: ProfileEnvelope
}

const enabledPlatformCount = (profile: ProfileEnvelope) => {
  const value = profile.settings.enabledPlatforms
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').length
    : 0
}

const ruleName = (rule: ProfileEnvelope['rules'][number]) => {
  if (rule.kind === 'identity') {
    return rule.displayName ?? rule.identityId
  }
  if (rule.kind === 'exact') {
    return rule.value
  }
  if (rule.kind === 'semantic') {
    return rule.description
  }
  return rule.targetId
}

export const HomePanel = ({ copy, onOpenRules, profile }: HomePanelProps) => {
  const activeRules = profile.rules.filter(rule => rule.enabled).length
  const recentRules = [...profile.rules]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3)

  return (
    <section className="home-panel">
      <header className="home-heading">
        <p>{copy.overviewTitle}</p>
        <h2>{copy.title}</h2>
        <span>{copy.description}</span>
      </header>
      <Surface className="home-hero" elevation="raised">
        <div aria-hidden="true" className="home-hero__signal">
          <ShieldCheck />
        </div>
        <strong className="home-hero__value">{activeRules}</strong>
        <span className="home-hero__label">{copy.activeRulesLabel}</span>
      </Surface>
      <Surface className="home-stats">
        <div className="home-stat-grid">
          <div>
            <strong>{activeRules}</strong>
            <span>{copy.activeRulesLabel}</span>
          </div>
          <div>
            <strong>{profile.feedbackExamples.length}</strong>
            <span>{copy.feedbackLabel}</span>
          </div>
          <div>
            <strong>{enabledPlatformCount(profile)}</strong>
            <span>{copy.enabledPlatformsLabel}</span>
          </div>
        </div>
      </Surface>
      <Surface className="home-activity">
        <div className="home-section">
          <h3>{copy.historyTitle}</h3>
          {recentRules.length > 0 ? (
            <ul className="home-history">
              {recentRules.map(rule => (
                <li key={rule.id}>
                  <span aria-hidden="true" className="home-history__icon">
                    <ShieldCheck />
                  </span>
                  <strong>{ruleName(rule)}</strong>
                  <span>
                    <code>{rule.updatedAt}</code>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>{copy.historyEmpty}</p>
          )}
        </div>
      </Surface>
      <Surface tone="subtle">
        <dl className="home-facts">
          <div>
            <dt>{copy.statisticsTitle}</dt>
            <dd>
              {copy.profileRevisionLabel}: <code>{profile.revision}</code>
            </dd>
          </div>
          <div>
            <dt>{copy.updatedLabel}</dt>
            <dd>
              <code>{profile.updatedAt}</code>
            </dd>
          </div>
        </dl>
      </Surface>
      <Button onClick={onOpenRules} size="full">
        {copy.openRulesAction}
        <ArrowRight aria-hidden="true" />
      </Button>
    </section>
  )
}
