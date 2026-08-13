import {
  extractRedditCandidate,
  readRedditCandidateSource,
  redditCandidateFingerprint
} from '@/adapters/reddit/extract'
import { redditCandidateSelector } from '@/adapters/reddit/selectors'
import type { RedditCandidate, RedditSurface } from '@/adapters/reddit/types'
import {
  type DomObservationHandle,
  observeDomCandidates
} from '@/adapters/shared/observe'

export type RedditObservationOptions = {
  onCandidate(candidate: RedditCandidate, element: Element): void
  onError?(
    reason: 'candidate-consumer-failed' | 'candidate-extraction-failed'
  ): void
  pageInstanceId: string
  surface: RedditSurface
}

export function observeRedditCandidates(
  root: Node & ParentNode,
  options: RedditObservationOptions
): DomObservationHandle {
  return observeDomCandidates(root, {
    candidateSelector: redditCandidateSelector(options.surface),
    extract: extractRedditCandidate,
    fingerprint: redditCandidateFingerprint,
    onCandidate: options.onCandidate,
    ...(options.onError ? { onError: options.onError } : {}),
    pageInstanceId: options.pageInstanceId,
    readSource: element => readRedditCandidateSource(element, options.surface)
  })
}
