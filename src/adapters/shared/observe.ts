export type DomObservationErrorReason =
  | 'candidate-consumer-failed'
  | 'candidate-extraction-failed'

export type DomObservationHandle = {
  applyIfCurrent(
    element: Element,
    pageInstanceId: string,
    apply: () => void
  ): boolean
  disconnect(): void
  isCurrent(element: Element, pageInstanceId: string): boolean
  scan(): void
}

export type DomObservationOptions<Source, Candidate> = {
  candidateSelector: string
  extract(
    element: Element,
    pageInstanceId: string,
    domId: string,
    source: Source
  ): Candidate
  fingerprint(source: Source): string
  onCandidate(candidate: Candidate, element: Element): void
  onError?(reason: DomObservationErrorReason): void
  pageInstanceId: string
  readSource(element: Element): Source
}

type ObservedCandidateState = {
  fingerprint: string
  pageInstanceId: string
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

export function observeDomCandidates<Source, Candidate>(
  root: Node & ParentNode,
  options: DomObservationOptions<Source, Candidate>
): DomObservationHandle {
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
      const source = options.readSource(element)
      const fingerprint = options.fingerprint(source)
      if (states.get(element)?.fingerprint === fingerprint) {
        return
      }
      const domId = domIdFor(element)
      const revision = (revisions.get(element) ?? -1) + 1
      const pageInstanceId = [
        options.pageInstanceId,
        domId,
        ...(revision > 0 ? [String(revision)] : [])
      ].join(':')
      states.set(element, { fingerprint, pageInstanceId })
      revisions.set(element, revision)
      const candidate = options.extract(element, pageInstanceId, domId, source)
      try {
        options.onCandidate(candidate, element)
      } catch {
        options.onError?.('candidate-consumer-failed')
      }
    } catch {
      options.onError?.('candidate-extraction-failed')
    }
  }

  const watchCandidate = (element: Element): void => {
    if (candidateObservers.has(element)) {
      return
    }
    const observer = new MutationObserver(() => processCandidate(element))
    observer.observe(element, {
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
    scanElements(root.querySelectorAll(options.candidateSelector))
  }

  const rootObserver = new MutationObserver(mutations => {
    const added = new Set<Element>()
    const removed = new Set<Element>()
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        for (const candidate of candidateElementsIn(
          node,
          options.candidateSelector
        )) {
          added.add(candidate)
        }
      }
      for (const node of mutation.removedNodes) {
        for (const candidate of candidateElementsIn(
          node,
          options.candidateSelector
        )) {
          removed.add(candidate)
        }
      }
    }
    for (const candidate of removed) {
      unwatchCandidate(candidate)
    }
    scanElements(
      [...added].filter(
        candidate => candidate.isConnected && root.contains(candidate)
      )
    )
  })

  rootObserver.observe(root, { childList: true, subtree: true })
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
