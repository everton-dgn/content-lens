import { describe, expect, it } from 'vitest'

import { startYouTubeContentRuntime } from '@/extension/content-script/youtube-runtime'
import {
  createServiceWorkerDecisionScheduler,
  SERVICE_WORKER_QUEUE_CAPACITY,
  SERVICE_WORKER_QUEUE_CONCURRENCY
} from '@/extension/service-worker/decision-runtime'
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

function renderCards(cycle: number) {
  const cards = Array.from({ length: 20 }, (_, index) => {
    const suffix = `${cycle}-${index}`.replace('-', '')
    return `
      <ytd-rich-item-renderer id="card-${cycle}-${index}">
        <a id="thumbnail" href="/watch?v=soakVideo${suffix}">Open</a>
        <a id="video-title-link" href="/watch?v=soakVideo${suffix}">Soak ${suffix}</a>
        <ytd-channel-name>
          <a href="/channel/UCsoakChannel${suffix}">Channel ${suffix}</a>
        </ytd-channel-name>
      </ytd-rich-item-renderer>
    `
  }).join('')
  document.documentElement.innerHTML = `<body><ytd-rich-grid-renderer>${cards}</ytd-rich-grid-renderer></body>`
}

describe('runtime soak bounds', () => {
  it('leaves no injected DOM after 100 observe, recycle, hide, reveal and disable cycles', async () => {
    const residualCounts: number[] = []

    for (let cycle = 0; cycle < 100; cycle += 1) {
      renderCards(cycle)
      const runtime = startYouTubeContentRuntime(document, {
        copy,
        pageInstanceId: `page:soak:${cycle}`,
        requestDecision: async () => ({
          action: 'show',
          profileRevision: cycle,
          reasonCode: 'default-show'
        }),
        surface: 'home'
      })
      expect(runtime.snapshot().controls).toBe(20)

      const actionHost = document.querySelector<HTMLElement>(
        '[data-contentlens-actions]'
      )
      actionHost?.shadowRoot
        ?.querySelector<HTMLButtonElement>('[data-contentlens-hide]')
        ?.click()
      const placeholder = document.querySelector<HTMLElement>(
        '[data-contentlens-placeholder]'
      )
      placeholder?.shadowRoot
        ?.querySelector<HTMLButtonElement>('[data-contentlens-reveal]')
        ?.click()

      document
        .querySelector<HTMLAnchorElement>(`#card-${cycle}-0 #video-title-link`)
        ?.setAttribute('href', `/watch?v=recycled${cycle}Video`)
      await new Promise<void>(resolve => queueMicrotask(resolve))
      runtime.disable()

      const residual = document.querySelectorAll(
        '[data-contentlens-actions], [data-contentlens-placeholder]'
      ).length
      residualCounts.push(residual)
      expect(runtime.snapshot()).toEqual({
        disabled: true,
        hidden: 0,
        controls: 0
      })
    }

    expect(new Set(residualCounts)).toEqual(new Set([0]))
  })

  it('keeps production scheduler state bounded under 10,000 overload attempts', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const scheduler = createServiceWorkerDecisionScheduler()
    const completions: Promise<unknown>[] = []

    for (let index = 0; index < 10_000; index += 1) {
      const result = scheduler.schedule({
        workId: `optional:${index}`,
        capability: 'optional-model',
        optional: true,
        priority: 'optional-offscreen',
        binding: {
          contentId: `youtube:video:${index}`,
          pageInstanceId: `page:${index}`,
          profileRevision: 1,
          capabilityVersion: 'optional-model@1',
          adapterVersion: 'youtube-adapter@1',
          policyVersion: 'deterministic-policy@1'
        },
        run: async () => {
          await gate
          return 'show'
        }
      })
      if ('completion' in result) {
        completions.push(result.completion)
      }
    }

    expect(scheduler.snapshot()).toEqual({
      active: SERVICE_WORKER_QUEUE_CONCURRENCY,
      pending: SERVICE_WORKER_QUEUE_CAPACITY,
      terminal: SERVICE_WORKER_QUEUE_CAPACITY + SERVICE_WORKER_QUEUE_CONCURRENCY
    })
    release?.()
    await Promise.all(completions)
    await Promise.resolve()
    expect(scheduler.snapshot()).toEqual({
      active: 0,
      pending: 0,
      terminal: SERVICE_WORKER_QUEUE_CAPACITY + SERVICE_WORKER_QUEUE_CONCURRENCY
    })
  })
})
