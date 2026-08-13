import { IDBFactory } from 'fake-indexeddb'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RssRuntimeState, RssSubscription } from '@/adapters/rss'
import { createLocalProfile } from '@/application/profile/local-profile'
import { ContentLensDatabase } from '@/storage/indexed-db/database'
import type { FeedPanelCopy } from '@/ui/feeds/copy'
import { FeedPanel, notifyRssRemoved } from '@/ui/feeds/FeedPanel'

const at = '2026-07-31T12:00:00.000Z'
const feedId = 'rss-feed:123e4567-e89b-42d3-a456-426614174000'
const copy = new Proxy(
  {},
  {
    get: (_target, key) => String(key)
  }
) as FeedPanelCopy

type MountedView = {
  container: HTMLDivElement
  root: Root
}

const mounted: MountedView[] = []

function subscription(
  id = feedId,
  state: RssSubscription['state'] = 'active'
): RssSubscription {
  return {
    schemaVersion: 1,
    feedId: id,
    url: `https://feeds.example/${id.slice(-4)}.xml`,
    origin: 'https://feeds.example',
    state,
    intervalMinutes: 60,
    createdAt: at,
    updatedAt: at
  }
}

async function databaseWithFeeds(
  databaseName: string,
  subscriptions: RssSubscription[]
) {
  const database = new ContentLensDatabase({
    factory: new IDBFactory(),
    databaseName
  })
  const profile = createLocalProfile({
    at,
    profileId: `profile:${databaseName}`
  })
  await database.saveProfile({
    ...profile,
    settings: { ...profile.settings, rssSubscriptions: subscriptions }
  })
  return database
}

async function mount(element: ReactElement): Promise<MountedView> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const view = { container, root }
  mounted.push(view)
  await act(async () => {
    root.render(element)
    await Promise.resolve()
  })
  return view
}

function button(container: HTMLElement, label: string) {
  const match = [...container.querySelectorAll('button')].find(
    candidate => candidate.textContent === label
  )
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }
  return match
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.click()
    await Promise.resolve()
  })
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  while (mounted.length > 0) {
    const view = mounted.pop()
    if (view) {
      await act(async () => {
        view.root.unmount()
      })
      view.container.remove()
    }
  }
})

describe('RSS feed panel', () => {
  it('validates worker acknowledgement before accepting cancellation', async () => {
    const sendMessage = vi.fn(async (message: unknown) => ({
      state: 'acknowledged',
      requestId: (message as { requestId: string }).requestId
    }))

    await expect(
      notifyRssRemoved(feedId, { sendMessage })
    ).resolves.toBeUndefined()
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ feedId, type: 'rss.cancel' })
    )

    sendMessage.mockResolvedValueOnce({ state: 'failed', requestId: 'other' })
    await expect(notifyRssRemoved(feedId, { sendMessage })).rejects.toThrow(
      'rss-cancellation-failed'
    )

    sendMessage.mockResolvedValueOnce({
      state: 'acknowledged',
      requestId: 'other'
    })
    await expect(notifyRssRemoved(feedId, { sendMessage })).rejects.toThrow(
      'rss-cancellation-failed'
    )
  })

  it('keeps network actions disabled while preserving local feed management', async () => {
    const database = await databaseWithFeeds('contentlens-feed-panel', [
      subscription()
    ])
    const onProfileChanged = vi.fn(async () => true)
    const notifyRemoved = vi.fn(async () => undefined)
    const view = await mount(
      <FeedPanel
        copy={copy}
        database={database}
        notifyRemoved={notifyRemoved}
        onProfileChanged={onProfileChanged}
      />
    )
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('https://feeds.example')
    )
    expect(view.container.querySelector('form')).toBeNull()
    expect(view.container.textContent).not.toContain('addAction')
    expect(view.container.textContent).not.toContain('editAction')
    expect(view.container.textContent).not.toContain('checkAction')

    await click(button(view.container, 'pauseAction'))
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('pausedStatus')
    )
    await click(button(view.container, 'resumeAction'))
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('statusNotChecked')
    )
    await click(button(view.container, 'removeAction'))
    expect(view.container.textContent).toContain('removeReviewTitle')
    await click(button(view.container, 'removeAction'))
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('emptyTitle')
    )
    expect(await database.exportProfile()).toMatchObject({
      revision: 3,
      settings: { rssSubscriptions: [] }
    })
    expect(onProfileChanged).toHaveBeenCalledTimes(3)
    expect(notifyRemoved).toHaveBeenCalledOnce()
    expect(notifyRemoved).toHaveBeenCalledWith(
      expect.stringMatching(/^rss-feed:/u)
    )
    database.close()
  })

  it('shows the browser limitation, invokes back navigation and reports load errors', async () => {
    const onBack = vi.fn()
    const database = {
      exportProfile: vi.fn(async () => {
        throw new Error('storage unavailable')
      }),
      readRssRuntimeStates: vi.fn(async () => [])
    } as unknown as ContentLensDatabase
    const view = await mount(
      <FeedPanel
        backLabel="back"
        copy={copy}
        database={database}
        onBack={onBack}
        onProfileChanged={vi.fn(async () => false)}
      />
    )

    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('errorTitle')
    )
    expect(view.container.textContent).toContain('browserUnavailableTitle')
    expect(view.container.textContent).toContain('browserPortableNote')
    const backAction = view.container.querySelector('[data-slot="back-action"]')
    expect(backAction?.getAttribute('data-size')).toBe('compact')
    expect(backAction?.getAttribute('data-variant')).toBe('quiet')
    expect(backAction?.parentElement?.getAttribute('data-slot')).toBe(
      'subpage-header'
    )
    expect(backAction?.querySelectorAll('svg')).toHaveLength(1)
    await click(button(view.container, 'back'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('maps every persisted runtime state to its visible status', async () => {
    const ids = [
      'rss-feed:123e4567-e89b-42d3-a456-426614174000',
      'rss-feed:123e4567-e89b-42d3-a456-426614174001',
      'rss-feed:123e4567-e89b-42d3-a456-426614174002',
      'rss-feed:123e4567-e89b-42d3-a456-426614174003',
      'rss-feed:123e4567-e89b-42d3-a456-426614174004',
      'rss-feed:123e4567-e89b-42d3-a456-426614174005',
      'rss-feed:123e4567-e89b-42d3-a456-426614174006'
    ]
    const feeds = ids.map((id, index) =>
      subscription(id, index === ids.length - 1 ? 'paused' : 'active')
    )
    const database = await databaseWithFeeds(
      'contentlens-feed-panel-runtime-states',
      feeds
    )
    const states: RssRuntimeState['state'][] = [
      'ready',
      'fetching',
      'scheduled',
      'failed',
      'unavailable',
      'idle'
    ]
    await Promise.all(
      states.map((state, index) =>
        database.replaceRssRuntimeState({
          schemaVersion: 1,
          feedId: ids[index],
          state,
          consecutiveFailures: state === 'failed' ? 1 : 0,
          updatedAt: at,
          ...(state === 'failed' ? { code: 'status-failed' as const } : {})
        })
      )
    )
    const view = await mount(
      <FeedPanel
        copy={copy}
        database={database}
        onProfileChanged={vi.fn(async () => true)}
      />
    )

    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('statusReady')
    )
    for (const label of [
      'statusFetching',
      'statusScheduled',
      'statusFailed',
      'statusUnavailable',
      'statusIdle',
      'pausedStatus'
    ]) {
      expect(view.container.textContent).toContain(label)
    }
    database.close()
  })

  it('covers removal cancellation and notification failure', async () => {
    const database = await databaseWithFeeds(
      'contentlens-feed-panel-failures',
      [subscription()]
    )
    const notifyRemoved = vi.fn(async () => {
      throw new Error('worker unavailable')
    })
    const view = await mount(
      <FeedPanel
        copy={copy}
        database={database}
        notifyRemoved={notifyRemoved}
        onProfileChanged={vi.fn(async () => true)}
      />
    )
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('https://feeds.example')
    )

    await click(button(view.container, 'removeAction'))
    await click(button(view.container, 'cancelAction'))
    expect(view.container.textContent).not.toContain('removeReviewTitle')
    await click(button(view.container, 'removeAction'))
    await click(button(view.container, 'removeAction'))
    await vi.waitFor(() => expect(notifyRemoved).toHaveBeenCalledWith(feedId))
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain('errorTitle')
    )
    database.close()
  })
})
