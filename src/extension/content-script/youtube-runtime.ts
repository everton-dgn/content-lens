import {
  normalizeYouTubeCandidate,
  observeYouTubeCandidates,
  type YouTubeCandidate,
  type YouTubeObservationHandle,
  type YouTubeSurface
} from '@/adapters/youtube'
import { ReversibleCandidateRenderer } from '@/adapters/youtube/rendering/reversible-renderer'
import type { RuntimeDecision } from '@/application/messages/contracts'
import type { ContentItem } from '@/core/content/contracts'
import { CandidateActionControls } from '@/ui/injected/candidate-actions'
import type { InjectedUiCopy } from '@/ui/injected/contracts'

type ObservedCandidate = {
  candidate: YouTubeCandidate
  node: Element
}

const maximumSessionActions = 1_024

export type YouTubeSessionActions = Map<string, 'hide' | 'show'>

export type YouTubeRuntimeFocusAnchor = {
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

const sessionKeyFor = ({ candidate }: ObservedCandidate) =>
  candidate.videoIdentity.status === 'stable'
    ? `video:${candidate.videoIdentity.platformContentId}`
    : `page:${candidate.pageInstanceId}`

const focusTargetFor = ({
  candidate,
  node
}: ObservedCandidate): YouTubeRuntimeFocusAnchor['target'] =>
  candidate.videoIdentity.status === 'stable'
    ? {
        status: 'stable',
        platformContentId: candidate.videoIdentity.platformContentId
      }
    : { status: 'ephemeral', element: node }

const matchesFocusTarget = (
  anchor: YouTubeRuntimeFocusAnchor | undefined,
  observed: ObservedCandidate
) => {
  if (!anchor) {
    return false
  }
  if (anchor.target.status === 'ephemeral') {
    return (
      observed.candidate.videoIdentity.status === 'ephemeral' &&
      anchor.target.element === observed.node
    )
  }
  return (
    observed.candidate.videoIdentity.status === 'stable' &&
    anchor.target.platformContentId ===
      observed.candidate.videoIdentity.platformContentId
  )
}

const contentKeyFor = ({ candidate }: ObservedCandidate) =>
  JSON.stringify([
    candidate.surface,
    candidate.title,
    candidate.videoIdentity.status === 'stable'
      ? candidate.videoIdentity.platformContentId
      : candidate.videoIdentity.reason,
    candidate.channelIdentity.status === 'stable'
      ? candidate.channelIdentity.channelId
      : candidate.channelIdentity.reason
  ])

export type YouTubeContentRuntimeOptions = {
  copy: InjectedUiCopy
  now?: () => Date
  pageInstanceId: string
  requestDecision(
    item: ContentItem,
    pageInstanceId: string
  ): Promise<RuntimeDecision | undefined>
  restoreFocus?: YouTubeRuntimeFocusAnchor
  sessionActions?: YouTubeSessionActions
  surface: YouTubeSurface
}

export type YouTubeContentRuntime = {
  captureFocus(): YouTubeRuntimeFocusAnchor | undefined
  disable(): void
  snapshot(): {
    disabled: boolean
    hidden: number
    controls: number
  }
}

export function startYouTubeContentRuntime(
  root: Document,
  options: YouTubeContentRuntimeOptions
): YouTubeContentRuntime {
  const renderer = new ReversibleCandidateRenderer(options.copy)
  const controls = new CandidateActionControls(options.copy)
  const latest = new WeakMap<Element, ObservedCandidate>()
  const ruleDecisions = new WeakMap<
    Element,
    {
      contentKey: string
      decision: RuntimeDecision
    }
  >()
  const sessionActions = options.sessionActions ?? new Map()
  const initial: ObservedCandidate[] = []
  const now = options.now ?? (() => new Date())
  let focusToRestore = options.restoreFocus
  let disabled = false
  let observation: YouTubeObservationHandle | undefined

  const rememberSessionAction = (
    observed: ObservedCandidate,
    action: 'hide' | 'show'
  ) => {
    const key = sessionKeyFor(observed)
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

  const reveal = (observed: ObservedCandidate) => {
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
    observed: ObservedCandidate,
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

  const mountControls = (observed: ObservedCandidate) => {
    if (disabled) {
      return
    }
    controls.mount(observed.node, () =>
      hide(observed, options.copy.reasonForSession, true, true)
    )
  }

  const applyRuleDecision = (
    observed: ObservedCandidate,
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
    observed: ObservedCandidate,
    replayedRule?: RuntimeDecision,
    preservedFocus?: YouTubeRuntimeFocusAnchor['kind']
  ) => {
    const restoresLifecycleFocus = matchesFocusTarget(focusToRestore, observed)
    const restoresFocus = restoresLifecycleFocus || Boolean(preservedFocus)
    if (sessionActions.get(sessionKeyFor(observed)) === 'hide') {
      hide(observed, options.copy.reasonForSession, false, restoresFocus)
    } else if (sessionActions.get(sessionKeyFor(observed)) === 'show') {
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

  const decide = async (observed: ObservedCandidate) => {
    const item = normalizeYouTubeCandidate(
      observed.candidate,
      now().toISOString()
    )
    try {
      const decision = await options.requestDecision(
        item,
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
            contentKey: contentKeyFor(observed),
            decision
          })
          const sessionAction = sessionActions.get(sessionKeyFor(observed))
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
      // Fail open. The platform candidate and its native controls stay visible.
      observation?.applyIfCurrent(
        observed.node,
        observed.candidate.pageInstanceId,
        () => controls.setDecisionState(observed.node, 'failed')
      )
    }
  }

  const observe = (candidate: YouTubeCandidate, node: Element) => {
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
        contentKeyFor(previous) === contentKeyFor({ candidate, node }) &&
        replayedRule?.contentKey === contentKeyFor(previous)
    )
    if (
      previous &&
      previous.candidate.pageInstanceId !== candidate.pageInstanceId &&
      !canReplayRule
    ) {
      renderer.restore(node)
      controls.remove(node)
    }
    const observed = { candidate, node }
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

  observation = observeYouTubeCandidates(root, {
    pageInstanceId: options.pageInstanceId,
    surface: options.surface,
    onCandidate: observe
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
      disabled,
      hidden: renderer.hiddenCount(),
      controls: controls.count()
    })
  }
}
