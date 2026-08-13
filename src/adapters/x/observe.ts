import {
  type DomObservationHandle,
  observeDomCandidates
} from '@/adapters/shared/observe'
import {
  extractXCandidate,
  readXCandidateSource,
  xCandidateFingerprint
} from '@/adapters/x/extract'
import { xSelectors } from '@/adapters/x/selectors'
import type { XCandidate, XSurface } from '@/adapters/x/types'

export type XObservationOptions = {
  onCandidate(candidate: XCandidate, element: Element): void
  onError?(
    reason: 'candidate-consumer-failed' | 'candidate-extraction-failed'
  ): void
  pageInstanceId: string
  surface: XSurface
}

const timelineLabels: Readonly<
  Record<'following' | 'for-you', readonly string[]>
> = {
  following: ['following', 'seguindo', 'siguiendo'],
  'for-you': ['for you', 'para você', 'para voce', 'para ti']
}

const normalizedLabel = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/\s+/gu, ' ')

export function detectXTimelineSurface(
  root: ParentNode
): 'following' | 'for-you' | undefined {
  const activeTab = root.querySelector('[role="tab"][aria-selected="true"]')
  if (!activeTab?.textContent) {
    return undefined
  }
  const label = normalizedLabel(activeTab.textContent)
  for (const [surface, labels] of Object.entries(timelineLabels) as Array<
    ['following' | 'for-you', readonly string[]]
  >) {
    if (labels.includes(label)) {
      return surface
    }
  }
  return undefined
}

export function observeXCandidates(
  root: Node & ParentNode,
  options: XObservationOptions
): DomObservationHandle {
  return observeDomCandidates(root, {
    candidateSelector: xSelectors.candidate,
    extract: extractXCandidate,
    fingerprint: xCandidateFingerprint,
    onCandidate: options.onCandidate,
    ...(options.onError ? { onError: options.onError } : {}),
    pageInstanceId: options.pageInstanceId,
    readSource: element =>
      readXCandidateSource(
        element,
        options.surface === 'for-you'
          ? (detectXTimelineSurface(root) ?? options.surface)
          : options.surface
      )
  })
}
