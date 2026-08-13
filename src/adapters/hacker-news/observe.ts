import {
  extractHackerNewsCandidate,
  hackerNewsCandidateFingerprint,
  readHackerNewsCandidateSource
} from '@/adapters/hacker-news/extract'
import { hackerNewsSelectors } from '@/adapters/hacker-news/selectors'
import type {
  HackerNewsCandidate,
  HackerNewsSurface
} from '@/adapters/hacker-news/types'
import {
  type DomObservationHandle,
  observeDomCandidates
} from '@/adapters/shared/observe'

export type HackerNewsObservationOptions = {
  onCandidate(candidate: HackerNewsCandidate, element: Element): void
  onError?(
    reason: 'candidate-consumer-failed' | 'candidate-extraction-failed'
  ): void
  pageInstanceId: string
  surface: HackerNewsSurface
}

const noCandidatesHandle = (): DomObservationHandle => ({
  applyIfCurrent: () => false,
  disconnect() {},
  isCurrent: () => false,
  scan() {}
})

export function observeHackerNewsCandidates(
  root: Node & ParentNode,
  options: HackerNewsObservationOptions
): DomObservationHandle {
  if (options.surface === 'item') {
    return noCandidatesHandle()
  }
  return observeDomCandidates(root, {
    candidateSelector: hackerNewsSelectors.candidate,
    extract: (element, pageInstanceId, domId, source) =>
      extractHackerNewsCandidate(
        options.surface as Exclude<HackerNewsSurface, 'item'>,
        element,
        pageInstanceId,
        domId,
        source
      ),
    fingerprint: hackerNewsCandidateFingerprint,
    onCandidate: options.onCandidate,
    ...(options.onError ? { onError: options.onError } : {}),
    pageInstanceId: options.pageInstanceId,
    readSource: readHackerNewsCandidateSource
  })
}
