import { describe, expect, it, vi } from 'vitest'

import type { RuntimeDecision } from '@/application/messages/contracts'
import { startYouTubeContentRuntime } from '@/extension/content-script/youtube-runtime'
import type { InjectedUiCopy } from '@/ui/injected/contracts'

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

const hideDecision: RuntimeDecision = {
  action: 'hide',
  profileRevision: 2,
  reasonCode: 'deterministic-rule'
}

const showDecision: RuntimeDecision = {
  action: 'show',
  profileRevision: 2,
  reasonCode: 'default-show'
}

const reviewDecision: RuntimeDecision = {
  action: 'review',
  profileRevision: 2,
  reasonCode: 'rule-conflict'
}

function renderCard() {
  document.documentElement.innerHTML = `
    <body>
      <ytd-rich-grid-renderer>
        <ytd-rich-item-renderer id="card" aria-hidden="false" style="border: 1px solid transparent">
          <a id="thumbnail" href="/watch?v=runtimeVideo01">Open</a>
          <a id="video-title-link" href="/watch?v=runtimeVideo01">Runtime title</a>
          <ytd-channel-name>
            <a href="/channel/UCruntimeChannel01">Runtime channel</a>
          </ytd-channel-name>
          <button id="native-action" type="button">Native action</button>
        </ytd-rich-item-renderer>
      </ytd-rich-grid-renderer>
    </body>
  `
  const card = document.getElementById('card')
  if (!card) {
    throw new Error('Fixture card was not created')
  }
  return card
}

function shadowButton(selector: string) {
  const host = document.querySelector<HTMLElement>(selector)
  const button = host?.shadowRoot?.querySelector<HTMLButtonElement>('button')
  if (!host || !button) {
    throw new Error(`Injected button was not found for ${selector}`)
  }
  return { button, host }
}

function candidateAction(candidate: Element) {
  const host = candidate.nextElementSibling as HTMLElement | null
  const button = host?.shadowRoot?.querySelector<HTMLButtonElement>('button')
  if (!host?.hasAttribute('data-contentlens-actions') || !button) {
    throw new Error('Candidate action was not found')
  }
  return { button, host }
}

function decisionAnnouncer() {
  const host = document.querySelector<HTMLElement>(
    '[data-contentlens-announcer]'
  )
  const status =
    host?.shadowRoot?.querySelector<HTMLElement>('[aria-live=polite]')
  if (!host || !status) {
    throw new Error('Decision announcer was not found')
  }
  return { host, status }
}

describe('injected YouTube runtime', () => {
  it('applies a deterministic hide, reveals in one action and restores attributes', async () => {
    const card = renderCard()
    const original = card.outerHTML
    const nativeAction = document.getElementById(
      'native-action'
    ) as HTMLButtonElement
    nativeAction.focus()
    const runtime = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:injected',
      requestDecision: async () => hideDecision,
      surface: 'home'
    })

    await vi.waitFor(() => expect(card.hasAttribute('hidden')).toBe(true))
    expect(runtime.snapshot()).toEqual({
      disabled: false,
      hidden: 1,
      controls: 0
    })

    const placeholder = document.querySelector<HTMLElement>(
      '[data-contentlens-placeholder]'
    )
    expect(placeholder?.getAttribute('aria-label')).toBe(copy.hiddenHeading)
    expect(
      placeholder?.shadowRoot?.querySelector('[data-contentlens-reason]')
        ?.textContent
    ).toBe(copy.reasonForRule)
    const reveal = placeholder?.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-contentlens-reveal]'
    )
    expect(reveal).not.toBeNull()
    expect(placeholder?.shadowRoot?.activeElement).toBe(reveal)

    reveal?.click()
    expect(card.outerHTML).toBe(original)
    expect(document.activeElement).toBe(nativeAction)
    expect(runtime.snapshot()).toEqual({
      disabled: false,
      hidden: 0,
      controls: 1
    })
    runtime.disable()
  })

  it('discards a late decision after the platform recycles a node', async () => {
    const card = renderCard()
    const pending: Array<(decision: RuntimeDecision) => void> = []
    const runtime = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:stale',
      requestDecision: () =>
        new Promise(resolve => {
          pending.push(resolve)
        }),
      surface: 'home'
    })
    await vi.waitFor(() => expect(pending).toHaveLength(1))

    card
      .querySelector<HTMLAnchorElement>('#thumbnail')
      ?.setAttribute('href', '/watch?v=recycledVideo02')
    await vi.waitFor(() => expect(pending).toHaveLength(2))

    pending[0]?.(hideDecision)
    await Promise.resolve()
    expect(card.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('[data-contentlens-placeholder]')).toBeNull()

    pending[1]?.(showDecision)
    await Promise.resolve()
    expect(card.hasAttribute('hidden')).toBe(false)
    expect(runtime.snapshot().controls).toBe(1)
    runtime.disable()
  })

  it('exposes pending and rule-conflict states with one contextual recovery path', async () => {
    const card = renderCard()
    let resolveDecision: ((decision: RuntimeDecision) => void) | undefined
    const runtime = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:conflict',
      requestDecision: () =>
        new Promise(resolve => {
          resolveDecision = resolve
        }),
      surface: 'home'
    })
    const actions = candidateAction(card)
    const group = actions.host.shadowRoot?.querySelector('[role=group]')
    const status =
      actions.host.shadowRoot?.querySelector<HTMLElement>('.decision-status')
    const announcer = decisionAnnouncer()

    expect(actions.host.dataset.contentlensDecision).toBe('pending')
    expect(group?.getAttribute('aria-busy')).toBe('true')
    expect(status?.textContent).toBe(copy.decisionPending)
    expect(status?.hasAttribute('aria-live')).toBe(false)
    expect(announcer.status.textContent).toBe(copy.decisionPending)

    resolveDecision?.(reviewDecision)
    await vi.waitFor(() =>
      expect(actions.host.dataset.contentlensDecision).toBe('conflict')
    )

    expect(card.hasAttribute('hidden')).toBe(false)
    expect(group?.getAttribute('aria-busy')).toBe('false')
    expect(status?.textContent).toBe(copy.decisionConflict)
    expect(announcer.status.textContent).toBe(copy.decisionConflict)
    expect(
      document.querySelectorAll('[data-contentlens-announcer]')
    ).toHaveLength(1)
    expect(actions.button.textContent).toBe(copy.hideForSession)
    runtime.disable()
  })

  it.each([
    ['committed visible decision', showDecision, 'applied'],
    ['expected decision deferral', undefined, 'deferred']
  ] as const)(
    'settles %s quietly without a dangling description',
    async (_label, decision, expectedState) => {
      const card = renderCard()
      const runtime = startYouTubeContentRuntime(document, {
        copy,
        pageInstanceId: `page:${expectedState}`,
        requestDecision: async () => decision,
        surface: 'home'
      })

      await vi.waitFor(() =>
        expect(candidateAction(card).host.dataset.contentlensDecision).toBe(
          expectedState
        )
      )
      const actions = candidateAction(card)
      const group = actions.host.shadowRoot?.querySelector('[role=group]')
      const status =
        actions.host.shadowRoot?.querySelector<HTMLElement>('.decision-status')

      expect(card.hasAttribute('hidden')).toBe(false)
      expect(group?.getAttribute('aria-busy')).toBe('false')
      expect(group?.hasAttribute('aria-describedby')).toBe(false)
      expect(status?.hidden).toBe(true)
      expect(status?.textContent).toBe('')
      runtime.disable()
      expect(document.querySelector('[data-contentlens-announcer]')).toBeNull()
    }
  )

  it('fails open when decision processing rejects', async () => {
    const card = renderCard()
    const runtime = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:failure',
      requestDecision: async () => {
        throw new Error('synthetic worker failure')
      },
      surface: 'home'
    })

    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-contentlens-actions]')
      ).not.toBeNull()
    )
    expect(card.hasAttribute('hidden')).toBe(false)
    expect(card.isConnected).toBe(true)
    expect(
      document
        .querySelector('[data-contentlens-actions]')
        ?.getAttribute('data-contentlens-decision')
    ).toBe('failed')
    const failedActions = candidateAction(card)
    expect(
      failedActions.host.shadowRoot?.querySelector('.decision-status')
        ?.textContent
    ).toBe(copy.decisionFailed)
    expect(decisionAnnouncer().status.textContent).toBe(copy.decisionFailed)
    expect(
      failedActions.host.shadowRoot
        ?.querySelector('[role=group]')
        ?.getAttribute('aria-busy')
    ).toBe('false')
    expect(runtime.snapshot()).toEqual({
      disabled: false,
      hidden: 0,
      controls: 1
    })
    runtime.disable()
  })

  it('keeps a session hide ahead of a late worker show', async () => {
    const card = renderCard()
    let resolveDecision: ((decision: RuntimeDecision) => void) | undefined
    const runtime = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:session-precedence',
      requestDecision: () =>
        new Promise(resolve => {
          resolveDecision = resolve
        }),
      surface: 'home'
    })

    shadowButton('[data-contentlens-actions]').button.click()
    expect(card.hasAttribute('hidden')).toBe(true)
    resolveDecision?.(showDecision)
    await Promise.resolve()

    expect(card.hasAttribute('hidden')).toBe(true)
    expect(runtime.snapshot().hidden).toBe(1)
    runtime.disable()
  })

  it('moves focus from a session action to reveal and back to the action', async () => {
    const card = renderCard()
    const runtime = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:session-focus',
      requestDecision: async () => showDecision,
      surface: 'home'
    })
    const hide = shadowButton('[data-contentlens-actions]').button
    hide.focus()
    hide.click()

    const placeholder = document.querySelector<HTMLElement>(
      '[data-contentlens-placeholder]'
    )
    const reveal = placeholder?.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-contentlens-reveal]'
    )
    expect(placeholder?.shadowRoot?.activeElement).toBe(reveal)

    reveal?.click()
    const actions = shadowButton('[data-contentlens-actions]')
    expect(actions.host.shadowRoot?.activeElement).toBe(actions.button)
    expect(card.hasAttribute('hidden')).toBe(false)
    runtime.disable()
  })

  it('keeps a session hide when the same video title changes', async () => {
    const card = renderCard()
    const runtime = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:session-title-change',
      requestDecision: async () => showDecision,
      surface: 'home'
    })
    shadowButton('[data-contentlens-actions]').button.click()
    expect(card.hasAttribute('hidden')).toBe(true)

    const title = card.querySelector('#video-title-link')
    if (!title) {
      throw new Error('Title fixture is missing')
    }
    title.textContent = 'Updated runtime title'

    await vi.waitFor(() => expect(card.hasAttribute('hidden')).toBe(true))
    expect(document.querySelector('[data-contentlens-actions]')).toBeNull()
    expect(
      document.querySelector('[data-contentlens-placeholder]')
    ).not.toBeNull()
    runtime.disable()
  })

  it('keeps a rule hide across an unchanged detach and reattach', async () => {
    const card = renderCard()
    const parent = card.parentElement
    const requestDecision = vi.fn(async () => hideDecision)
    const runtime = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:rule-reattach',
      requestDecision,
      surface: 'home'
    })
    await vi.waitFor(() => expect(card.hasAttribute('hidden')).toBe(true))
    expect(requestDecision).toHaveBeenCalledTimes(1)
    if (!parent) {
      throw new Error('Card parent was not created')
    }

    card.remove()
    parent.append(card)

    await vi.waitFor(() =>
      expect(
        card.nextElementSibling?.hasAttribute('data-contentlens-placeholder')
      ).toBe(true)
    )
    expect(card.hasAttribute('hidden')).toBe(true)
    expect(requestDecision).toHaveBeenCalledTimes(1)
    expect(
      document.querySelectorAll('[data-contentlens-placeholder]')
    ).toHaveLength(1)
    expect(runtime.snapshot()).toMatchObject({ hidden: 1, controls: 0 })
    runtime.disable()
  })

  it('preserves action focus across replay and changed-content reobservation', async () => {
    const card = renderCard()
    const parent = card.parentElement
    const requestDecision = vi.fn(async () => showDecision)
    const runtime = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:focused-reobservation',
      requestDecision,
      surface: 'home'
    })
    await vi.waitFor(() => expect(requestDecision).toHaveBeenCalledTimes(1))
    candidateAction(card).button.focus()
    if (!parent) {
      throw new Error('Card parent was not created')
    }

    card.remove()
    parent.append(card)

    await vi.waitFor(() =>
      expect(candidateAction(card).host.shadowRoot?.activeElement).toBe(
        candidateAction(card).button
      )
    )
    expect(requestDecision).toHaveBeenCalledTimes(1)

    const title = card.querySelector('#video-title-link')
    if (!title) {
      throw new Error('Title fixture is missing')
    }
    title.textContent = 'Changed while focused'

    await vi.waitFor(() => expect(requestDecision).toHaveBeenCalledTimes(2))
    expect(candidateAction(card).host.shadowRoot?.activeElement).toBe(
      candidateAction(card).button
    )
    runtime.disable()
  })

  it('applies a restored session hide before a failing worker response', async () => {
    const card = renderCard()
    const runtime = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:restored-session',
      requestDecision: async () => {
        throw new Error('synthetic worker failure')
      },
      sessionActions: new Map([['video:runtimeVideo01', 'hide']]),
      surface: 'home'
    })

    expect(card.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('[data-contentlens-actions]')).toBeNull()
    expect(
      document.querySelector('[data-contentlens-placeholder]')
    ).not.toBeNull()
    await Promise.resolve()
    expect(card.hasAttribute('hidden')).toBe(true)
    runtime.disable()
  })

  it('restores placeholder focus across a runtime restart', async () => {
    const card = renderCard()
    const first = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:focus-before-restart',
      requestDecision: async () => hideDecision,
      surface: 'home'
    })
    await vi.waitFor(() => expect(card.hasAttribute('hidden')).toBe(true))
    const firstReveal = shadowButton('[data-contentlens-placeholder]').button
    firstReveal.focus()
    const focus = first.captureFocus()
    expect(focus).toEqual({
      kind: 'placeholder',
      target: {
        status: 'stable',
        platformContentId: 'runtimeVideo01'
      }
    })
    first.disable()

    const restarted = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:focus-after-restart',
      requestDecision: async () => hideDecision,
      restoreFocus: focus,
      surface: 'home'
    })
    await vi.waitFor(() => expect(card.hasAttribute('hidden')).toBe(true))
    const restartedPlaceholder = shadowButton('[data-contentlens-placeholder]')
    expect(restartedPlaceholder.host.shadowRoot?.activeElement).toBe(
      restartedPlaceholder.button
    )
    restarted.disable()
  })

  it('restores ephemeral focus to the same element after reordering', () => {
    document.documentElement.innerHTML = `
      <body>
        <ytd-watch-next-secondary-results-renderer>
          <yt-lockup-view-model><h3>First ephemeral</h3></yt-lockup-view-model>
          <yt-lockup-view-model><h3>Focused ephemeral</h3></yt-lockup-view-model>
        </ytd-watch-next-secondary-results-renderer>
      </body>
    `
    const candidates = [...document.querySelectorAll('yt-lockup-view-model')]
    const focusedCandidate = candidates[1]
    if (!focusedCandidate) {
      throw new Error('Ephemeral focus fixture was not created')
    }
    const first = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:ephemeral-focus-before',
      requestDecision: async () => showDecision,
      surface: 'recommendations'
    })
    candidateAction(focusedCandidate).button.focus()
    const focus = first.captureFocus()
    expect(focus).toEqual({
      kind: 'actions',
      target: {
        status: 'ephemeral',
        element: focusedCandidate
      }
    })
    first.disable()

    focusedCandidate.parentElement?.insertAdjacentHTML(
      'afterbegin',
      '<yt-lockup-view-model><h3>Inserted ephemeral</h3></yt-lockup-view-model>'
    )
    const restarted = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:ephemeral-focus-after',
      requestDecision: async () => showDecision,
      restoreFocus: focus,
      surface: 'recommendations'
    })

    expect(
      candidateAction(focusedCandidate).host.shadowRoot?.activeElement
    ).toBe(candidateAction(focusedCandidate).button)
    const reorderedCandidate = document.querySelector('yt-lockup-view-model')
    if (!reorderedCandidate) {
      throw new Error('Reordered candidate was not created')
    }
    expect(document.activeElement).not.toBe(
      candidateAction(reorderedCandidate).host
    )
    restarted.disable()
  })

  it('restores hidden candidates and removes controls when disabled', () => {
    const card = renderCard()
    const original = card.outerHTML
    const runtime = startYouTubeContentRuntime(document, {
      copy,
      pageInstanceId: 'page:disable',
      requestDecision: async () => showDecision,
      surface: 'home'
    })

    shadowButton('[data-contentlens-actions]').button.click()
    expect(card.hasAttribute('hidden')).toBe(true)
    runtime.disable()

    expect(card.outerHTML).toBe(original)
    expect(document.querySelector('[data-contentlens-placeholder]')).toBeNull()
    expect(document.querySelector('[data-contentlens-actions]')).toBeNull()
    expect(runtime.snapshot()).toEqual({
      disabled: true,
      hidden: 0,
      controls: 0
    })
  })
})
