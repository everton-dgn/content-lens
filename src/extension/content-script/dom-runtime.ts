import type { DomObservationHandle } from '@/adapters/shared/observe'
import { ReversibleCandidateRenderer } from '@/adapters/shared/reversible-renderer'
import type { RuntimeDecision } from '@/application/messages/contracts'
import type { ContentItem } from '@/core/content/contracts'
import type { PlatformSurface } from '@/core/content/surfaces'
import { CandidateActionControls } from '@/ui/injected/candidate-actions'
import type { InjectedUiCopy } from '@/ui/injected/contracts'

export type DomRuntimeCandidate = {
  pageInstanceId: string
}

export type DomRuntimeObserverOptions<Candidate extends DomRuntimeCandidate> = {
  enabledSurfaces: readonly PlatformSurface[]
  onCandidate(candidate: Candidate, element: Element): void
  pageInstanceId: string
  surface: PlatformSurface
}

export type DomRuntimeAdapter<Candidate extends DomRuntimeCandidate> = {
  normalize(candidate: Candidate, observedAt: string): ContentItem
  observe(
    root: Node & ParentNode,
    options: DomRuntimeObserverOptions<Candidate>
  ): DomObservationHandle
}

type ObservedCandidate<Candidate extends DomRuntimeCandidate> = {
  candidate: Candidate
  item: ContentItem
  node: Element
}

export type DomRuntimeFocusAnchor = {
  kind: 'actions' | 'placeholder'
  target:
    | {
        status: 'stable'
        platformContentId: string
      }
    | {
        status: 'ephemeral'
        element: Element
      }
}

export type DomRuntimeSessionActions = Map<string, 'hide' | 'show'>

export type DomContentRuntimeOptions<Candidate extends DomRuntimeCandidate> = {
  adapter: DomRuntimeAdapter<Candidate>
  copy: InjectedUiCopy
  enabledSurfaces: readonly PlatformSurface[]
  now?: () => Date
  pageInstanceId: string
  requestDecision(
    item: ContentItem,
    pageInstanceId: string
  ): Promise<RuntimeDecision | undefined>
  restoreFocus?: DomRuntimeFocusAnchor
  sessionActions?: DomRuntimeSessionActions
  surface: PlatformSurface
}

export type DomContentRuntime = {
  captureFocus(): DomRuntimeFocusAnchor | undefined
  disable(): void
  snapshot(): {
    controls: number
    disabled: boolean
    hidden: number
  }
}

const maximumSessionActions = 1_024

const identityKey = (item: ContentItem) =>
  item.identity.status === 'stable'
    ? `stable:${item.platform}:${item.identity.platformContentId}`
    : `page:${item.identity.pageInstanceId}`

const focusTargetFor = <Candidate extends DomRuntimeCandidate>({
  item,
  node
}: ObservedCandidate<Candidate>): DomRuntimeFocusAnchor['target'] =>
  item.identity.status === 'stable'
    ? {
        status: 'stable',
        platformContentId: item.identity.platformContentId
      }
    : { status: 'ephemeral', element: node }

const matchesFocusTarget = <Candidate extends DomRuntimeCandidate>(
  anchor: DomRuntimeFocusAnchor | undefined,
  observed: ObservedCandidate<Candidate>
) => {
  if (!anchor) {
    return false
  }
  if (anchor.target.status === 'ephemeral') {
    return (
      observed.item.identity.status === 'ephemeral' &&
      anchor.target.element === observed.node
    )
  }
  return (
    observed.item.identity.status === 'stable' &&
    anchor.target.platformContentId === observed.item.identity.platformContentId
  )
}

const contentKeyFor = (item: ContentItem) => {
  const { observedAt: _observedAt, ...stableContent } = item
  return JSON.stringify(stableContent)
}

export function startDomContentRuntime<Candidate extends DomRuntimeCandidate>(
  root: Document,
  options: DomContentRuntimeOptions<Candidate>
): DomContentRuntime {
  const renderer = new ReversibleCandidateRenderer(options.copy)
  const controls = new CandidateActionControls(options.copy)
  const latest = new WeakMap<Element, ObservedCandidate<Candidate>>()
  const ruleDecisions = new WeakMap<
    Element,
    {
      contentKey: string
      decision: RuntimeDecision
    }
  >()
  const sessionActions = options.sessionActions ?? new Map()
  const initial: ObservedCandidate<Candidate>[] = []
  const now = options.now ?? (() => new Date())
  let focusToRestore = options.restoreFocus
  let disabled = false
  let observation: DomObservationHandle | undefined

  const rememberSessionAction = (
    observed: ObservedCandidate<Candidate>,
    action: 'hide' | 'show'
  ) => {
    const key = identityKey(observed.item)
    sessionActions.delete(key)
    sessionActions.set(key, action)
    while (sessionActions.size > maximumSessionActions) {
      const oldest = sessionActions.keys().next().value
      if (oldest === undefined) {
        break
      }
      sessionActions.delete(oldest)
    }
  }

  const reveal = (observed: ObservedCandidate<Candidate>) => {
    if (
      disabled ||
      !observation?.isCurrent(observed.node, observed.candidate.pageInstanceId)
    ) {
      return
    }
    rememberSessionAction(observed, 'show')
    const restored = renderer.restore(observed.node)
    mountControls(observed)
    if (restored === 'restored') {
      controls.focus(observed.node)
    }
  }

  const hide = (
    observed: ObservedCandidate<Candidate>,
    reason: string,
    sessionAction = false,
    moveFocusToReveal = false
  ) => {
    if (disabled) {
      return
    }
    observation?.applyIfCurrent(
      observed.node,
      observed.candidate.pageInstanceId,
      () => {
        if (sessionAction) {
          rememberSessionAction(observed, 'hide')
        }
        const shouldMoveFocus =
          moveFocusToReveal || controls.hasFocus(observed.node)
        controls.remove(observed.node)
        renderer.hide(observed.node, {
          moveFocusToReveal: shouldMoveFocus,
          pageInstanceId: observed.candidate.pageInstanceId,
          reason,
          onReveal: () => reveal(observed)
        })
      }
    )
  }

  const mountControls = (observed: ObservedCandidate<Candidate>) => {
    if (disabled) {
      return
    }
    controls.mount(observed.node, () =>
      hide(observed, options.copy.reasonForSession, true, true)
    )
  }

  const applyRuleDecision = (
    observed: ObservedCandidate<Candidate>,
    decision: RuntimeDecision,
    restoresFocus = false
  ) => {
    if (decision.action === 'hide') {
      hide(observed, options.copy.reasonForRule, false, restoresFocus)
      return
    }
    renderer.restore(observed.node)
    mountControls(observed)
    controls.setDecisionState(
      observed.node,
      decision.action === 'review' ? 'conflict' : 'applied'
    )
    if (restoresFocus) {
      controls.focus(observed.node)
    }
  }

  const applyObservedState = (
    observed: ObservedCandidate<Candidate>,
    replayedRule?: RuntimeDecision,
    preservedFocus?: DomRuntimeFocusAnchor['kind']
  ) => {
    const restoresLifecycleFocus = matchesFocusTarget(focusToRestore, observed)
    const restoresFocus = restoresLifecycleFocus || Boolean(preservedFocus)
    const sessionAction = sessionActions.get(identityKey(observed.item))
    if (sessionAction === 'hide') {
      hide(observed, options.copy.reasonForSession, false, restoresFocus)
    } else if (sessionAction === 'show') {
      renderer.restore(observed.node)
      mountControls(observed)
      controls.setDecisionState(observed.node, 'applied')
      if (restoresFocus) {
        controls.focus(observed.node)
      }
    } else if (replayedRule) {
      applyRuleDecision(observed, replayedRule, restoresFocus)
    } else {
      mountControls(observed)
      if (restoresFocus) {
        controls.focus(observed.node)
      }
    }
    if (restoresLifecycleFocus) {
      focusToRestore = undefined
    }
  }

  const decide = async (observed: ObservedCandidate<Candidate>) => {
    try {
      const decision = await options.requestDecision(
        observed.item,
        observed.candidate.pageInstanceId
      )
      if (!decision || disabled) {
        if (!disabled) {
          observation?.applyIfCurrent(
            observed.node,
            observed.candidate.pageInstanceId,
            () => controls.setDecisionState(observed.node, 'deferred')
          )
        }
        return
      }
      observation?.applyIfCurrent(
        observed.node,
        observed.candidate.pageInstanceId,
        () => {
          ruleDecisions.set(observed.node, {
            contentKey: contentKeyFor(observed.item),
            decision
          })
          const sessionAction = sessionActions.get(identityKey(observed.item))
          if (sessionAction === 'hide') {
            hide(observed, options.copy.reasonForSession)
            return
          }
          if (sessionAction === 'show') {
            renderer.restore(observed.node)
            mountControls(observed)
            controls.setDecisionState(observed.node, 'applied')
            return
          }
          applyRuleDecision(observed, decision)
        }
      )
    } catch {
      observation?.applyIfCurrent(
        observed.node,
        observed.candidate.pageInstanceId,
        () => controls.setDecisionState(observed.node, 'failed')
      )
    }
  }

  const observe = (candidate: Candidate, node: Element) => {
    const item = options.adapter.normalize(candidate, now().toISOString())
    const previous = latest.get(node)
    const replayedRule = ruleDecisions.get(node)
    const preservedFocus =
      renderer.focusedCandidate() === node
        ? ('placeholder' as const)
        : controls.hasFocus(node)
          ? ('actions' as const)
          : undefined
    const canReplayRule = Boolean(
      previous &&
        previous.candidate.pageInstanceId !== candidate.pageInstanceId &&
        contentKeyFor(previous.item) === contentKeyFor(item) &&
        replayedRule?.contentKey === contentKeyFor(previous.item)
    )
    if (
      previous &&
      previous.candidate.pageInstanceId !== candidate.pageInstanceId &&
      !canReplayRule
    ) {
      renderer.restore(node)
      controls.remove(node)
    }
    const observed = { candidate, item, node }
    latest.set(node, observed)

    if (observation) {
      if (canReplayRule && replayedRule) {
        controls.remove(node)
        applyObservedState(observed, replayedRule.decision, preservedFocus)
      } else {
        applyObservedState(observed, undefined, preservedFocus)
        void decide(observed)
      }
    } else {
      initial.push(observed)
    }
  }

  observation = options.adapter.observe(root, {
    enabledSurfaces: options.enabledSurfaces,
    onCandidate: observe,
    pageInstanceId: options.pageInstanceId,
    surface: options.surface
  })
  for (const observed of initial) {
    applyObservedState(observed)
    void decide(observed)
  }

  return {
    captureFocus: () => {
      const placeholderCandidate = renderer.focusedCandidate()
      const placeholderObserved = placeholderCandidate
        ? latest.get(placeholderCandidate)
        : undefined
      if (placeholderObserved) {
        return {
          kind: 'placeholder',
          target: focusTargetFor(placeholderObserved)
        }
      }
      const actionCandidate = controls.focusedCandidate()
      const actionObserved = actionCandidate
        ? latest.get(actionCandidate)
        : undefined
      return actionObserved
        ? {
            kind: 'actions',
            target: focusTargetFor(actionObserved)
          }
        : undefined
    },
    disable: () => {
      if (disabled) {
        return
      }
      disabled = true
      observation?.disconnect()
      controls.removeAll()
      renderer.restoreAll()
    },
    snapshot: () => ({
      controls: controls.count(),
      disabled,
      hidden: renderer.hiddenCount()
    })
  }
}
