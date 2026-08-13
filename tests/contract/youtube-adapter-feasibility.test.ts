import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  extractYouTubeCandidates,
  observeYouTubeCandidates,
  type YouTubeCandidate,
  type YouTubeSurface
} from '@/adapters/youtube'
import { MAX_CONTENT_TITLE_LENGTH } from '@/core/content/contracts'

const activeObservers: Array<{ disconnect(): void }> = []

const loadFixture = async (
  name: 'home' | 'related' | 'search'
): Promise<void> => {
  document.documentElement.innerHTML = await readFile(
    resolve('tests', 'fixtures', 'youtube', `${name}.html`),
    'utf8'
  )
}

const observe = (
  surface: YouTubeSurface,
  onCandidate: (candidate: YouTubeCandidate) => void,
  onError?: (error: { reason: string; surface: YouTubeSurface }) => void
) => {
  const handle = observeYouTubeCandidates(document, {
    onCandidate,
    ...(onError ? { onError } : {}),
    pageInstanceId: `page-${surface}-feasibility`,
    surface
  })
  activeObservers.push(handle)
  return handle
}

const createHomeCard = (sequence: number): Element => {
  const wrapper = document.createElement('div')
  const suffix = String(sequence).padStart(6, '0')
  wrapper.innerHTML = `
    <ytd-rich-item-renderer id="home-dynamic-${suffix}">
      <a id="thumbnail" href="/watch?v=dyn${suffix}A">Open video</a>
      <h3><a id="video-title-link" href="/watch?v=dyn${suffix}A">Synthetic dynamic ${suffix}</a></h3>
      <ytd-channel-name><a href="/channel/UCdynamic${suffix}Alpha">Synthetic Dynamic Channel</a></ytd-channel-name>
    </ytd-rich-item-renderer>
  `
  const element = wrapper.firstElementChild
  if (!element) {
    throw new Error('Synthetic dynamic card was not created.')
  }
  return element
}

describe('YouTube Phase 0 feasibility adapter', () => {
  afterEach(() => {
    for (const observer of activeObservers.splice(0)) {
      observer.disconnect()
    }
    document.documentElement.innerHTML = ''
  })

  it('observes initial and infinite-scroll candidates once', async () => {
    await loadFixture('home')
    const candidates: YouTubeCandidate[] = []
    const handle = observe('home', candidate => candidates.push(candidate))

    expect(candidates).toHaveLength(2)
    const contents = document.getElementById('contents')
    expect(contents).not.toBeNull()

    const fragment = document.createDocumentFragment()
    for (let sequence = 0; sequence < 1_000; sequence += 1) {
      fragment.append(createHomeCard(sequence))
    }
    contents?.append(fragment)

    await vi.waitFor(() => expect(candidates).toHaveLength(1_002))
    expect(
      new Set(candidates.map(({ pageInstanceId }) => pageInstanceId)).size
    ).toBe(candidates.length)

    const beforeFullRescan = candidates.length
    handle.scan()
    expect(candidates).toHaveLength(beforeFullRescan)
    handle.disconnect()

    document.body.replaceChildren()
    document.body.append(createHomeCard(1_000))
    const duplicateCandidates: YouTubeCandidate[] = []
    const duplicateHandle = observe('home', candidate =>
      duplicateCandidates.push(candidate)
    )
    expect(duplicateCandidates).toHaveLength(1)

    const beforeDuplicateScans = duplicateCandidates.length
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      duplicateHandle.scan()
    }
    const duplicateEmissions = duplicateCandidates.length - beforeDuplicateScans
    const suppressionRate = 1 - duplicateEmissions / 1_000

    expect(suppressionRate).toBeGreaterThanOrEqual(0.999)
  }, 10_000)

  it('changes the page-instance ID when a node is recycled', async () => {
    await loadFixture('related')
    const candidates: YouTubeCandidate[] = []
    const handle = observe('recommendations', candidate =>
      candidates.push(candidate)
    )
    const element = document.getElementById('related-card-stable')
    expect(element).not.toBeNull()

    const initial = candidates.find(
      ({ domId }) => domId === 'related-card-stable'
    )
    expect(initial).toBeDefined()

    const thumbnail = element?.querySelector<HTMLAnchorElement>('#thumbnail')
    thumbnail?.setAttribute('href', '/watch?v=recycleA01')

    await vi.waitFor(() =>
      expect(
        candidates.filter(({ domId }) => domId === 'related-card-stable')
      ).toHaveLength(2)
    )
    const recycled = candidates.at(-1)

    expect(recycled).toMatchObject({
      domId: 'related-card-stable',
      pageInstanceId: 'page-recommendations-feasibility:related-card-stable:1',
      videoIdentity: {
        status: 'stable',
        platformContentId: 'recycleA01'
      }
    })
    expect(initial?.pageInstanceId).not.toBe(recycled?.pageInstanceId)
    expect(
      initial && element
        ? handle.isCurrent(element, initial.pageInstanceId)
        : true
    ).toBe(false)
    expect(
      recycled && element
        ? handle.isCurrent(element, recycled.pageInstanceId)
        : false
    ).toBe(true)

    let staleResultsApplied = 0
    const staleApplied =
      initial && element
        ? handle.applyIfCurrent(element, initial.pageInstanceId, () => {
            staleResultsApplied += 1
          })
        : true
    expect(staleApplied).toBe(false)
    expect(staleResultsApplied).toBe(0)

    const currentApplied =
      recycled && element
        ? handle.applyIfCurrent(element, recycled.pageInstanceId, () => {
            staleResultsApplied += 1
          })
        : false
    expect(currentApplied).toBe(true)
    expect(staleResultsApplied).toBe(1)
  })

  it('keeps page-instance revisions monotonic after detach and reattach', async () => {
    await loadFixture('related')
    const candidates: YouTubeCandidate[] = []
    const handle = observe('recommendations', candidate =>
      candidates.push(candidate)
    )
    const element = document.getElementById('related-card-stable')
    const parent = element?.parentElement
    const initial = candidates.find(
      ({ domId }) => domId === 'related-card-stable'
    )
    if (!element || !parent || !initial) {
      throw new Error('Detach fixture was not created')
    }

    element.remove()
    element
      .querySelector<HTMLAnchorElement>('#thumbnail')
      ?.setAttribute('href', '/watch?v=reattachB02')
    parent.append(element)

    await vi.waitFor(() =>
      expect(
        candidates.filter(({ domId }) => domId === 'related-card-stable')
      ).toHaveLength(2)
    )
    const reattached = candidates.at(-1)
    expect(reattached?.pageInstanceId).toBe(
      'page-recommendations-feasibility:related-card-stable:1'
    )
    expect(handle.isCurrent(element, initial.pageInstanceId)).toBe(false)
    expect(
      reattached ? handle.isCurrent(element, reattached.pageInstanceId) : false
    ).toBe(true)
  })

  it('re-emits stable video identities when title or channel data changes', async () => {
    await loadFixture('home')
    const candidates: YouTubeCandidate[] = []
    observe('home', candidate => candidates.push(candidate))
    const element = document.getElementById('home-card-stable')
    const initialCount = candidates.length

    element
      ?.querySelector('#video-title-link')
      ?.replaceChildren('Updated title')

    await vi.waitFor(() => expect(candidates).toHaveLength(initialCount + 1))
    expect(candidates.at(-1)).toMatchObject({
      domId: 'home-card-stable',
      title: 'Updated title'
    })

    element
      ?.querySelector<HTMLAnchorElement>('ytd-channel-name a')
      ?.setAttribute('href', '/channel/UCupdatedChannel123')

    await vi.waitFor(() => expect(candidates).toHaveLength(initialCount + 2))
    expect(candidates.at(-1)).toMatchObject({
      channelIdentity: {
        channelId: 'UCupdatedChannel123',
        status: 'stable'
      },
      domId: 'home-card-stable'
    })
  })

  it('bounds untrusted title text before normalization', async () => {
    await loadFixture('home')
    document
      .getElementById('video-title-link')
      ?.replaceChildren('x'.repeat(MAX_CONTENT_TITLE_LENGTH + 1_000))

    const [candidate] = extractYouTubeCandidates(document, {
      pageInstanceId: 'page-bounded-title',
      surface: 'home'
    })

    expect(candidate?.title).toHaveLength(MAX_CONTENT_TITLE_LENGTH)
  })

  it('keeps anonymous page-instance IDs bound to node identity across rescans', () => {
    document.documentElement.innerHTML = `
      <ytd-rich-item-renderer>
        <a id="thumbnail" href="/watch?v=anonymousA01">Open video</a>
        <h3><a id="video-title-link">Anonymous first</a></h3>
      </ytd-rich-item-renderer>
    `
    const context = {
      pageInstanceId: 'page-anonymous',
      surface: 'home'
    } as const
    const [first] = extractYouTubeCandidates(document, context)
    const [rescanned] = extractYouTubeCandidates(document, context)

    expect(rescanned?.pageInstanceId).toBe(first?.pageInstanceId)

    document.querySelector('ytd-rich-item-renderer')?.insertAdjacentHTML(
      'beforebegin',
      `
          <ytd-rich-item-renderer>
            <a id="thumbnail" href="/watch?v=anonymousB02">Open video</a>
            <h3><a id="video-title-link">Anonymous second</a></h3>
          </ytd-rich-item-renderer>
        `
    )
    const [inserted, original] = extractYouTubeCandidates(document, context)

    expect(inserted?.pageInstanceId).not.toBe(original?.pageInstanceId)
    expect(original?.pageInstanceId).toBe(first?.pageInstanceId)
  })

  it('contains consumer failures and leaves the platform DOM visible', async () => {
    await loadFixture('search')
    const errors: Array<{ reason: string; surface: YouTubeSurface }> = []
    const element = document.getElementById('search-card-alpha')
    expect(element).not.toBeNull()

    observe(
      'search',
      () => {
        throw new Error('synthetic consumer failure')
      },
      error => errors.push(error)
    )

    expect(errors).toHaveLength(2)
    expect(new Set(errors)).toEqual(
      new Set([
        {
          reason: 'candidate-consumer-failed',
          surface: 'search'
        },
        {
          reason: 'candidate-consumer-failed',
          surface: 'search'
        }
      ])
    )
    expect(element?.isConnected).toBe(true)
    expect(element?.hasAttribute('hidden')).toBe(false)
    expect((element as HTMLElement | null)?.style.display).not.toBe('none')
    expect(document.querySelector('[data-contentlens-placeholder]')).toBeNull()
  })

  it('fails open and represents invalid identities explicitly', async () => {
    await loadFixture('home')
    const element = document.getElementById('home-card-stable')
    element
      ?.querySelector<HTMLAnchorElement>('#thumbnail')
      ?.setAttribute('href', '/watch?v=invalid%20identity')
    element
      ?.querySelector<HTMLAnchorElement>('ytd-channel-name a')
      ?.setAttribute('href', '/channel/not-a-stable-channel')

    const [candidate] = extractYouTubeCandidates(document, {
      pageInstanceId: 'page-invalid-feasibility',
      surface: 'home'
    })

    expect(candidate).toMatchObject({
      channelIdentity: {
        status: 'ephemeral',
        reason: 'invalid'
      },
      diagnosticReason: 'video-id-invalid',
      durableChannelActions: false,
      durableVideoActions: false,
      videoIdentity: {
        status: 'ephemeral',
        reason: 'invalid'
      }
    })
    expect(element?.hasAttribute('hidden')).toBe(false)
    expect((element as HTMLElement | null)?.style.display).not.toBe('none')
  })
})
