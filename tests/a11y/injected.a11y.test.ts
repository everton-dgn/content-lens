import { describe, expect, it } from 'vitest'

import { ReversibleCandidateRenderer } from '@/adapters/youtube/rendering/reversible-renderer'
import { CandidateActionControls } from '@/ui/injected/candidate-actions'
import type { InjectedUiCopy } from '@/ui/injected/contracts'
import {
  injectedColorTokens,
  injectedSurfaceStyles
} from '@/ui/styles/tokens/injected'

const copy: InjectedUiCopy = {
  actionsLabel: 'ContentLens actions',
  decisionConflict:
    'Conflicting local rules kept this item visible. Review the rules in ContentLens or hide it for this session.',
  decisionFailed:
    'ContentLens could not check this item. It stays visible. You can hide it for this session.',
  decisionPending: 'Checking local rules. This item stays visible.',
  hiddenHeading: 'Content hidden by ContentLens',
  hideForSession: 'Hide for this session',
  reasonForRule: 'Reason: matched a local rule',
  reasonForSession: 'Reason: hidden for this session',
  reveal: 'Show'
}

const relativeLuminance = (hex: string) => {
  const channels = hex
    .slice(1)
    .match(/.{2}/gu)
    ?.map(channel => Number.parseInt(channel, 16) / 255)
  if (channels?.length !== 3) {
    throw new Error(`Invalid test color: ${hex}`)
  }
  const [red = 0, green = 0, blue = 0] = channels.map(channel =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

const contrastRatio = (left: string, right: string) => {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right))
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('injected accessibility contract', () => {
  it('provides named actions and deduplicates shared announcements', async () => {
    document.body.innerHTML = `
      <article id="candidate"><button id="origin">Native action</button></article>
      <article id="candidate-two"><button>Second native action</button></article>
    `
    const candidate = document.getElementById('candidate')
    const secondCandidate = document.getElementById('candidate-two')
    if (!candidate || !secondCandidate) {
      throw new Error('Candidate fixture is missing')
    }
    const controls = new CandidateActionControls(copy)
    controls.mount(candidate, () => undefined)
    const actionHost = document.querySelector<HTMLElement>(
      '[data-contentlens-actions]'
    )
    const actionGroup = actionHost?.shadowRoot?.querySelector('[role=group]')
    const decisionStatus =
      actionHost?.shadowRoot?.querySelector<HTMLElement>('.decision-status')
    const announcerHost = document.querySelector<HTMLElement>(
      '[data-contentlens-announcer]'
    )
    const announcer =
      announcerHost?.shadowRoot?.querySelector<HTMLElement>(
        '[aria-live=polite]'
      )
    const hide = actionHost?.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-contentlens-hide]'
    )
    if (!announcer) {
      throw new Error('Shared decision announcer is missing')
    }
    const announcementMutations: MutationRecord[] = []
    const announcementObserver = new MutationObserver(records => {
      announcementMutations.push(...records)
    })
    announcementObserver.observe(announcer, {
      characterData: true,
      childList: true,
      subtree: true
    })
    controls.mount(secondCandidate, () => undefined)
    await Promise.resolve()

    expect(
      document.querySelectorAll('[data-contentlens-actions]')
    ).toHaveLength(2)
    expect(announcementMutations).toHaveLength(0)
    expect(
      document.querySelectorAll('[data-contentlens-announcer]')
    ).toHaveLength(1)
    expect(announcer.getAttribute('role')).toBe('status')
    expect(announcer.textContent).toBe(copy.decisionPending)
    expect(actionHost?.hasAttribute('aria-label')).toBe(false)
    expect(actionGroup?.getAttribute('aria-label')).toBe(copy.actionsLabel)
    expect(actionGroup?.getAttribute('aria-busy')).toBe('true')
    expect(actionGroup?.getAttribute('aria-describedby')).toBe(
      decisionStatus?.id
    )
    expect(decisionStatus?.textContent).toBe(copy.decisionPending)
    expect(decisionStatus?.hasAttribute('aria-live')).toBe(false)
    expect(hide?.type).toBe('button')
    expect(hide?.textContent).toBe(copy.hideForSession)

    controls.setDecisionState(candidate, 'conflict')
    await Promise.resolve()
    const firstConflictMutationCount = announcementMutations.length
    expect(firstConflictMutationCount).toBeGreaterThan(0)
    expect(announcer.textContent).toBe(copy.decisionConflict)
    controls.setDecisionState(secondCandidate, 'conflict')
    await Promise.resolve()
    expect(announcementMutations).toHaveLength(firstConflictMutationCount)
    announcementObserver.disconnect()

    const renderer = new ReversibleCandidateRenderer(copy)
    renderer.hide(candidate, {
      pageInstanceId: 'page:a11y',
      reason: copy.reasonForRule,
      onReveal: () => undefined
    })
    const placeholder = document.querySelector<HTMLElement>(
      '[data-contentlens-placeholder]'
    )
    const status = placeholder?.shadowRoot?.querySelector('[role=status]')
    const reveal = placeholder?.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-contentlens-reveal]'
    )

    expect(placeholder?.getAttribute('aria-label')).toBe(copy.hiddenHeading)
    expect(status).not.toBeNull()
    expect(reveal?.type).toBe('button')
    expect(reveal?.textContent).toBe(copy.reveal)
    expect(injectedSurfaceStyles).toContain('min-block-size: 2.75rem')
    expect(injectedSurfaceStyles).not.toContain('transition:')
    controls.removeAll()
    expect(document.querySelector('[data-contentlens-announcer]')).toBeNull()
  })

  it.each(Object.entries(injectedColorTokens))(
    'keeps text and focus contrast above WCAG AA in the %s palette',
    (_palette, tokens) => {
      expect(
        contrastRatio(tokens.foreground, tokens.background)
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(tokens.actionForeground, tokens.actionBackground)
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(tokens.focus, tokens.background)
      ).toBeGreaterThanOrEqual(3)
      expect(
        contrastRatio(tokens.signal, tokens.background)
      ).toBeGreaterThanOrEqual(3)
    }
  )
})
