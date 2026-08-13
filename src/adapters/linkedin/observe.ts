import {
  extractLinkedInCandidate,
  linkedInCandidateFingerprint,
  readLinkedInCandidateSource
} from '@/adapters/linkedin/extract'
import { linkedInSelectors } from '@/adapters/linkedin/selectors'
import type {
  LinkedInCandidate,
  LinkedInObservationError,
  LinkedInSurface
} from '@/adapters/linkedin/types'
import {
  type DomObservationHandle,
  observeDomCandidates
} from '@/adapters/shared/observe'

export type LinkedInObservationOptions = {
  onCandidate(candidate: LinkedInCandidate, element: Element): void
  onError?(error: LinkedInObservationError): void
  pageInstanceId: string
  surface: LinkedInSurface
}

export function observeLinkedInCandidates(
  root: Node & ParentNode,
  options: LinkedInObservationOptions
): DomObservationHandle {
  return observeDomCandidates(root, {
    candidateSelector: linkedInSelectors.candidate,
    extract: extractLinkedInCandidate,
    fingerprint: linkedInCandidateFingerprint,
    onCandidate: options.onCandidate,
    onError: reason =>
      options.onError?.({ reason, surface: `linkedin:${options.surface}` }),
    pageInstanceId: options.pageInstanceId,
    readSource: element => readLinkedInCandidateSource(element, options.surface)
  })
}
