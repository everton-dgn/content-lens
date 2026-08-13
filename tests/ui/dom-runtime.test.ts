import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DomObservationHandle } from '@/adapters/shared/observe'
import type { RuntimeDecision } from '@/application/messages/contracts'
import type { ContentItem } from '@/core/content/contracts'
import {
  type DomRuntimeAdapter,
  startDomContentRuntime
} from '@/extension/content-script/dom-runtime'

const copy = {
  actionsLabel: 'ContentLens actions',
  decisionConflict: 'Rules conflict',
  decisionFailed: 'Decision failed',
  decisionPending: 'Decision pending',
  hiddenHeading: 'Hidden content',
  hideForSession: 'Hide for this session',
  reasonForRule: 'Hidden by rule',
  reasonForSession: 'Hidden for this session',
  reveal: 'Reveal'
}

type Candidate = {
  pageInstanceId: string
  platformContentId: string
  title: string
}

function itemFor(candidate: Candidate, observedAt: string): ContentItem {
  return {
    id: `reddit:item:${candidate.platformContentId}`,
    platform: 'reddit',
    identity: {
      status: 'stable',
      platformContentId: candidate.platformContentId
    },
    surface: 'reddit:home',
    title: candidate.title,
    media: [],
    observedAt,
    context: {}
  }
}

function adapterFor(
  element: Element,
  candidate: Candidate
): {
  adapter: DomRuntimeAdapter<Candidate>
  current: Set<string>
  handle: DomObservationHandle
} {
  const current = new Set([candidate.pageInstanceId])
  const handle: DomObservationHandle = {
    applyIfCurrent: (_element, pageInstanceId, apply) => {
      if (!current.has(pageInstanceId)) {
        return false
      }
      apply()
      return true
    },
    disconnect: vi.fn(),
    isCurrent: (_element, pageInstanceId) => current.has(pageInstanceId),
    scan: vi.fn()
  }
  return {
    current,
    handle,
    adapter: {
      normalize: itemFor,
      observe: (_root, options) => {
        options.onCandidate(candidate, element)
        return handle
      }
    }
  }
}

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-contentlens-runtime-ready')
})

describe('shared DOM content runtime', () => {
  it('keeps show and review decisions visible with session hide, reveal and focus capture', async () => {
    const element = document.createElement('article')
    element.textContent = 'Session candidate'
    document.body.append(element)
    const candidate = {
      pageInstanceId: 'page:session:candidate:1',
      platformContentId: 'post-session',
      title: 'Session candidate'
    }
    const fixture = adapterFor(element, candidate)
    const sessionActions = new Map<string, 'hide' | 'show'>()
    const runtime = startDomContentRuntime(document, {
      adapter: fixture.adapter,
      copy,
      enabledSurfaces: ['reddit:home'],
      pageInstanceId: 'page:session',
      requestDecision: async () => ({
        action: 'review',
        profileRevision: 1,
        reasonCode: 'rule-conflict'
      }),
      sessionActions,
      surface: 'reddit:home'
    })

    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-contentlens-decision='conflict']")
      ).not.toBeNull()
    )
    const actions = document.querySelector<HTMLElement>(
      '[data-contentlens-actions]'
    )
    const hide = actions?.shadowRoot?.querySelector('button')
    if (!(hide instanceof HTMLButtonElement)) {
      throw new Error('Session hide action not found')
    }
    hide.focus()
    expect(runtime.captureFocus()).toMatchObject({ kind: 'actions' })
    hide.click()
    expect(element.hidden).toBe(true)
    expect(sessionActions.get('stable:reddit:post-session')).toBe('hide')
    expect(runtime.captureFocus()).toMatchObject({ kind: 'placeholder' })

    const placeholder = document.querySelector<HTMLElement>(
      '[data-contentlens-placeholder]'
    )
    const reveal = placeholder?.shadowRoot?.querySelector('button')
    if (!(reveal instanceof HTMLButtonElement)) {
      throw new Error('Reveal action not found')
    }
    reveal.click()
    expect(element.hidden).toBe(false)
    expect(sessionActions.get('stable:reddit:post-session')).toBe('show')
    expect(runtime.snapshot()).toMatchObject({ controls: 1, hidden: 0 })
    runtime.disable()
    runtime.disable()
  })

  it('marks absent decisions as deferred without hiding content', async () => {
    const element = document.createElement('article')
    document.body.append(element)
    const candidate = {
      pageInstanceId: 'page:deferred:candidate:1',
      platformContentId: 'post-deferred',
      title: 'Deferred candidate'
    }
    const fixture = adapterFor(element, candidate)
    const runtime = startDomContentRuntime(document, {
      adapter: fixture.adapter,
      copy,
      enabledSurfaces: ['reddit:home'],
      pageInstanceId: 'page:deferred',
      requestDecision: async () => undefined,
      surface: 'reddit:home'
    })

    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-contentlens-decision='deferred']")
      ).not.toBeNull()
    )
    expect(element.hidden).toBe(false)
    runtime.disable()
  })

  it('replays a stable rule across recycled nodes only when content is unchanged', async () => {
    const element = document.createElement('article')
    document.body.append(element)
    let onCandidate:
      | ((candidate: Candidate, element: Element) => void)
      | undefined
    const current = new Set(['page:recycle:1', 'page:recycle:2'])
    const handle: DomObservationHandle = {
      applyIfCurrent: (_element, pageInstanceId, apply) => {
        if (!current.has(pageInstanceId)) return false
        apply()
        return true
      },
      disconnect: vi.fn(),
      isCurrent: (_element, pageInstanceId) => current.has(pageInstanceId),
      scan: vi.fn()
    }
    const adapter: DomRuntimeAdapter<Candidate> = {
      normalize: itemFor,
      observe: (_root, options) => {
        onCandidate = options.onCandidate
        options.onCandidate(
          {
            pageInstanceId: 'page:recycle:1',
            platformContentId: 'post-recycle',
            title: 'Same content'
          },
          element
        )
        return handle
      }
    }
    const requestDecision = vi.fn(
      async (): Promise<RuntimeDecision> => ({
        action: 'hide',
        profileRevision: 1,
        reasonCode: 'deterministic-rule'
      })
    )
    const runtime = startDomContentRuntime(document, {
      adapter,
      copy,
      enabledSurfaces: ['reddit:home'],
      pageInstanceId: 'page:recycle',
      requestDecision,
      surface: 'reddit:home'
    })
    await vi.waitFor(() => expect(element.hidden).toBe(true))

    onCandidate?.(
      {
        pageInstanceId: 'page:recycle:2',
        platformContentId: 'post-recycle',
        title: 'Same content'
      },
      element
    )
    await Promise.resolve()
    expect(element.hidden).toBe(true)
    expect(requestDecision).toHaveBeenCalledOnce()

    onCandidate?.(
      {
        pageInstanceId: 'page:recycle:3',
        platformContentId: 'post-new',
        title: 'Changed content'
      },
      element
    )
    expect(element.hidden).toBe(false)
    runtime.disable()
  })

  it('applies a current hide decision and restores the original node on disable', async () => {
    const element = document.createElement('article')
    element.textContent = 'Visible candidate'
    document.body.append(element)
    const candidate = {
      pageInstanceId: 'page:1:candidate:1',
      platformContentId: 'post-1',
      title: 'Visible candidate'
    }
    const fixture = adapterFor(element, candidate)
    const runtime = startDomContentRuntime(document, {
      adapter: fixture.adapter,
      copy,
      enabledSurfaces: ['reddit:home'],
      now: () => new Date('2026-07-31T00:00:00.000Z'),
      pageInstanceId: 'page:1',
      requestDecision: async (): Promise<RuntimeDecision> => ({
        action: 'hide',
        profileRevision: 1,
        reasonCode: 'deterministic-rule'
      }),
      surface: 'reddit:home'
    })

    await vi.waitFor(() => expect(element.hidden).toBe(true))
    expect(runtime.snapshot()).toMatchObject({ hidden: 1, disabled: false })
    expect(
      document.querySelector('[data-contentlens-placeholder]')
    ).not.toBeNull()

    runtime.disable()

    expect(element.hidden).toBe(false)
    expect(document.querySelector('[data-contentlens-placeholder]')).toBeNull()
    expect(fixture.handle.disconnect).toHaveBeenCalledOnce()
  })

  it('rejects a late result after the observer invalidates the candidate', async () => {
    const element = document.createElement('article')
    document.body.append(element)
    const candidate = {
      pageInstanceId: 'page:1:candidate:1',
      platformContentId: 'post-1',
      title: 'Recycled candidate'
    }
    const fixture = adapterFor(element, candidate)
    let resolveDecision: ((decision: RuntimeDecision) => void) | undefined
    const runtime = startDomContentRuntime(document, {
      adapter: fixture.adapter,
      copy,
      enabledSurfaces: ['reddit:home'],
      pageInstanceId: 'page:1',
      requestDecision: () =>
        new Promise(resolve => {
          resolveDecision = resolve
        }),
      surface: 'reddit:home'
    })
    fixture.current.clear()

    resolveDecision?.({
      action: 'hide',
      profileRevision: 1,
      reasonCode: 'deterministic-rule'
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(element.hidden).toBe(false)
    expect(runtime.snapshot().hidden).toBe(0)
    runtime.disable()
  })

  it('fails open when decision processing rejects', async () => {
    const element = document.createElement('article')
    document.body.append(element)
    const candidate = {
      pageInstanceId: 'page:1:candidate:1',
      platformContentId: 'post-1',
      title: 'Visible after failure'
    }
    const fixture = adapterFor(element, candidate)
    const runtime = startDomContentRuntime(document, {
      adapter: fixture.adapter,
      copy,
      enabledSurfaces: ['reddit:home'],
      pageInstanceId: 'page:1',
      requestDecision: async () => {
        throw new Error('synthetic-decision-failure')
      },
      surface: 'reddit:home'
    })

    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-contentlens-decision='failed']")
      ).not.toBeNull()
    )
    expect(element.hidden).toBe(false)
    runtime.disable()
  })
})
