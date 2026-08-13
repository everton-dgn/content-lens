import {
  candidateFingerprint,
  extractYouTubeCandidate,
  readCandidateSource
} from '@/adapters/youtube/extract'
import { youtubeSelectors } from '@/adapters/youtube/selectors'
import type {
  YouTubeObservationHandle,
  YouTubeObservationOptions
} from '@/adapters/youtube/types'

interface ObservedCandidateState {
  fingerprint: string
  pageInstanceId: string
  revision: number
}

const candidateElementsIn = (node: Node, selector: string): Element[] => {
  if (!(node instanceof Element)) {
    return []
  }

  return [
    ...(node.matches(selector) ? [node] : []),
    ...node.querySelectorAll(selector)
  ]
}

export const observeYouTubeCandidates = (
  root: Node & ParentNode,
  options: YouTubeObservationOptions
): YouTubeObservationHandle => {
  const selector = youtubeSelectors[options.surface].candidate
  const states = new WeakMap<Element, ObservedCandidateState>()
  const revisions = new WeakMap<Element, number>()
  const anonymousIds = new WeakMap<Element, string>()
  const candidateObservers = new Map<Element, MutationObserver>()
  let anonymousSequence = 0

  const domIdFor = (element: Element): string => {
    if (element.id) {
      return element.id
    }

    const existing = anonymousIds.get(element)
    if (existing) {
      return existing
    }

    anonymousSequence += 1
    const generated = `candidate-${anonymousSequence}`
    anonymousIds.set(element, generated)
    return generated
  }

  const processCandidate = (element: Element): void => {
    try {
      const source = readCandidateSource(element, options)
      const fingerprint = candidateFingerprint(source)
      const previous = states.get(element)
      if (previous?.fingerprint === fingerprint) {
        return
      }

      const domId = domIdFor(element)
      const revision = (revisions.get(element) ?? -1) + 1
      const pageInstanceId = [
        options.pageInstanceId,
        domId,
        ...(revision > 0 ? [String(revision)] : [])
      ].join(':')

      states.set(element, { fingerprint, pageInstanceId, revision })
      revisions.set(element, revision)
      const candidate = extractYouTubeCandidate(
        element,
        options,
        pageInstanceId,
        domId,
        source
      )

      try {
        options.onCandidate(candidate, element)
      } catch {
        options.onError?.({
          reason: 'candidate-consumer-failed',
          surface: options.surface
        })
      }
    } catch {
      options.onError?.({
        reason: 'candidate-extraction-failed',
        surface: options.surface
      })
    }
  }

  const watchCandidate = (element: Element): void => {
    if (candidateObservers.has(element)) {
      return
    }
    const observer = new MutationObserver(() => processCandidate(element))
    observer.observe(element, {
      attributeFilter: ['href', 'id'],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    })
    candidateObservers.set(element, observer)
  }

  const unwatchCandidate = (element: Element): void => {
    candidateObservers.get(element)?.disconnect()
    candidateObservers.delete(element)
    states.delete(element)
  }

  const scanElements = (elements: Iterable<Element>): void => {
    for (const element of new Set(elements)) {
      watchCandidate(element)
      processCandidate(element)
    }
  }

  const scan = (): void => {
    scanElements(root.querySelectorAll(selector))
  }

  const rootObserver = new MutationObserver(mutations => {
    const addedCandidates = new Set<Element>()
    const removedCandidates = new Set<Element>()
    for (const mutation of mutations) {
      for (const addedNode of mutation.addedNodes) {
        for (const candidate of candidateElementsIn(addedNode, selector)) {
          addedCandidates.add(candidate)
        }
      }
      for (const removedNode of mutation.removedNodes) {
        for (const candidate of candidateElementsIn(removedNode, selector)) {
          removedCandidates.add(candidate)
        }
      }
    }
    for (const candidate of removedCandidates) {
      unwatchCandidate(candidate)
    }
    scanElements(
      [...addedCandidates].filter(
        candidate => candidate.isConnected && root.contains(candidate)
      )
    )
  })

  rootObserver.observe(root, {
    childList: true,
    subtree: true
  })
  scan()

  return {
    applyIfCurrent: (element, pageInstanceId, apply) => {
      if (states.get(element)?.pageInstanceId !== pageInstanceId) {
        return false
      }
      apply()
      return true
    },
    disconnect: () => {
      rootObserver.disconnect()
      for (const observer of candidateObservers.values()) {
        observer.disconnect()
      }
      candidateObservers.clear()
    },
    isCurrent: (element, pageInstanceId) =>
      states.get(element)?.pageInstanceId === pageInstanceId,
    scan
  }
}
