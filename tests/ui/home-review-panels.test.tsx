import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import type { Rule } from '@/core/rules/contracts/rule'
import type { HomePanelCopy } from '@/ui/home/copy'
import { HomePanel } from '@/ui/home/HomePanel'
import type { ReviewPanelCopy } from '@/ui/review/copy'
import { ReviewPanel } from '@/ui/review/ReviewPanel'

const copy = <T,>() =>
  new Proxy({}, { get: (_target, key) => String(key) }) as T

const render = (markup: ReactNode) =>
  new DOMParser().parseFromString(renderToStaticMarkup(markup), 'text/html')

describe('Home and review panels', () => {
  it('shows overview, history and statistics from the current local profile', () => {
    const profile = createLocalProfile({
      at: '2026-07-31T12:00:00.000Z',
      profileId: 'profile:test'
    })
    const page = render(
      <HomePanel
        copy={copy<HomePanelCopy>()}
        onOpenRules={vi.fn()}
        profile={profile}
      />
    )

    expect(page.querySelector('h2')?.textContent).toBe('title')
    expect(page.body.textContent).toContain('historyTitle')
    expect(page.body.textContent).toContain('statisticsTitle')
    expect(page.body.textContent).toContain('profileRevisionLabel: 0')
    expect(
      [...page.querySelectorAll('code')].map(node => node.textContent)
    ).toEqual(['0', '2026-07-31T12:00:00.000Z'])
    expect(
      page.querySelectorAll('[data-slot="button"][data-variant="primary"]')
    ).toHaveLength(1)
  })

  it('shows the newest identity, exact, semantic and preference rule names', () => {
    const profile = createLocalProfile({
      at: '2026-07-31T12:00:00.000Z',
      profileId: 'profile:history'
    })
    const base = {
      enabled: true,
      scope: {},
      createdAt: '2026-07-31T12:00:00.000Z'
    }
    profile.rules = [
      {
        ...base,
        id: 'identity',
        kind: 'identity',
        effect: 'allow',
        platform: 'youtube',
        identityType: 'channel',
        identityId: 'channel:trusted',
        displayName: 'Trusted channel',
        updatedAt: '2026-07-31T16:00:00.000Z'
      },
      {
        ...base,
        id: 'exact',
        kind: 'exact',
        effect: 'block',
        field: 'title',
        value: 'Spoilers',
        caseSensitive: false,
        updatedAt: '2026-07-31T15:00:00.000Z'
      },
      {
        ...base,
        id: 'semantic',
        kind: 'semantic',
        effect: 'reduce',
        description: 'Repeated outrage bait',
        examples: [],
        exclusions: [],
        threshold: 0.8,
        updatedAt: '2026-07-31T14:00:00.000Z'
      },
      {
        ...base,
        id: 'preference',
        kind: 'preference',
        target: 'topic',
        targetId: 'science',
        weight: 1,
        updatedAt: '2026-07-31T13:00:00.000Z'
      }
    ] satisfies Rule[]
    profile.feedbackExamples = [
      {
        id: 'feedback:1',
        contentId: 'content:1',
        action: 'show-less',
        createdAt: '2026-07-31T16:00:00.000Z'
      }
    ]
    profile.settings.enabledPlatforms = ['youtube', 'reddit', 42]

    const page = render(
      <HomePanel
        copy={copy<HomePanelCopy>()}
        onOpenRules={vi.fn()}
        profile={profile}
      />
    )

    expect(page.body.textContent).toContain('Trusted channel')
    expect(page.body.textContent).toContain('Spoilers')
    expect(page.body.textContent).toContain('Repeated outrage bait')
    expect(page.body.textContent).not.toContain('science')
    expect(
      [...page.querySelectorAll('.home-history code')].map(
        node => node.textContent
      )
    ).toEqual([
      '2026-07-31T16:00:00.000Z',
      '2026-07-31T15:00:00.000Z',
      '2026-07-31T14:00:00.000Z'
    ])
    expect(
      page.querySelectorAll('.home-stat-grid strong')[1]?.textContent
    ).toBe('1')
    expect(
      page.querySelectorAll('.home-stat-grid strong')[2]?.textContent
    ).toBe('2')
  })

  it('falls back to identity id and zero platforms for malformed legacy settings', () => {
    const profile = createLocalProfile({
      at: '2026-07-31T12:00:00.000Z',
      profileId: 'profile:legacy'
    })
    profile.rules = [
      {
        id: 'identity',
        enabled: false,
        scope: {},
        kind: 'identity',
        effect: 'block',
        platform: 'reddit',
        identityType: 'author',
        identityId: 'author:fallback',
        createdAt: '2026-07-31T12:00:00.000Z',
        updatedAt: '2026-07-31T12:00:00.000Z'
      }
    ]
    profile.settings.enabledPlatforms = 'youtube'

    const page = render(
      <HomePanel
        copy={copy<HomePanelCopy>()}
        onOpenRules={vi.fn()}
        profile={profile}
      />
    )
    expect(page.body.textContent).toContain('author:fallback')
    expect(
      page.querySelectorAll('.home-stat-grid strong')[0]?.textContent
    ).toBe('0')
    expect(
      page.querySelectorAll('.home-stat-grid strong')[2]?.textContent
    ).toBe('0')
  })

  it('renders a fail-open loading state before review data resolves', () => {
    const page = render(
      <ReviewPanel
        copy={copy<ReviewPanelCopy>()}
        database={{
          readGraphDerivedState: vi.fn(),
          readSimilarityDerivedState: vi.fn(),
          replaceSimilarityDerivedState: vi.fn()
        }}
      />
    )
    const state = page.querySelector('[data-slot="state-panel"]')

    expect(state?.getAttribute('data-state')).toBe('loading')
    expect(state?.textContent).toContain('loadingTitle')
    expect(state?.textContent).toContain('loadingDescription')
    expect(state?.querySelector('button')).toBeNull()
  })
})
