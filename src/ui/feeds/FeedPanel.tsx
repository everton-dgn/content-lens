import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import { browser } from 'wxt/browser'

import type { RssRuntimeState, RssSubscription } from '@/adapters/rss'
import { FeedSubscriptionService } from '@/application/feed-subscriptions'
import {
  CONTENT_LENS_MESSAGE_NAMESPACE,
  type RuntimeMessageResponse
} from '@/application/messages/contracts'
import type { OperationResponse } from '@/core/operations/journal'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'
import { BackAction, Badge, Button, Notice, Surface } from '@/ui/components'
import type { FeedPanelCopy } from '@/ui/feeds/copy'

type Feedback = {
  body: string
  title: string
  tone: 'error' | 'info' | 'success' | 'degraded'
}

export type FeedPanelProps = {
  backLabel?: string
  copy: FeedPanelCopy
  database: ContentLensDatabase
  onBack?(): void
  onProfileChanged(): Promise<boolean>
  notifyRemoved?: (feedId: string) => Promise<void>
}

const statusTone = (
  subscription: RssSubscription,
  state: RssRuntimeState | undefined
) => {
  if (subscription.state === 'paused') {
    return 'neutral' as const
  }
  if (state?.state === 'ready') {
    return 'success' as const
  }
  if (state?.state === 'fetching' || state?.state === 'scheduled') {
    return 'info' as const
  }
  return state?.state === 'failed' || state?.state === 'unavailable'
    ? ('degraded' as const)
    : ('neutral' as const)
}

export const notifyRssRemoved = async (
  feedId: string,
  runtime: { sendMessage(message: unknown): Promise<unknown> }
): Promise<void> => {
  const requestId = `request:rss-cancel:${crypto.randomUUID()}`
  const response = (await runtime.sendMessage({
    namespace: CONTENT_LENS_MESSAGE_NAMESPACE,
    version: 1,
    type: 'rss.cancel',
    requestId,
    feedId
  })) as RuntimeMessageResponse
  if (response.state !== 'acknowledged' || response.requestId !== requestId) {
    throw new Error('rss-cancellation-failed')
  }
}

const defaultNotifyRemoved = (feedId: string) =>
  notifyRssRemoved(feedId, browser.runtime)

export const FeedPanel = ({
  backLabel,
  copy,
  database,
  onBack,
  onProfileChanged,
  notifyRemoved = defaultNotifyRemoved
}: FeedPanelProps) => {
  const service = useMemo(
    () => new FeedSubscriptionService({ database }),
    [database]
  )
  const [subscriptions, setSubscriptions] = useState<RssSubscription[]>([])
  const [runtimeStates, setRuntimeStates] = useState<RssRuntimeState[]>([])
  const [removeFeedId, setRemoveFeedId] = useState<string>()
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>()

  const load = useCallback(async () => {
    const [feeds, states] = await Promise.all([
      service.list(),
      database.readRssRuntimeStates()
    ])
    setSubscriptions(feeds)
    setRuntimeStates(states)
  }, [database, service])

  useEffect(() => {
    void load().catch(() =>
      setFeedback({
        body: copy.errorBody,
        title: copy.errorTitle,
        tone: 'error'
      })
    )
  }, [copy.errorBody, copy.errorTitle, load])

  const refreshAfterMutation = async () => {
    await onProfileChanged()
    await load()
  }

  const mutate = async (
    operation: (
      revision: number,
      at: string
    ) => Promise<OperationResponse<unknown>>
  ) => {
    setPending(true)
    setFeedback(undefined)
    try {
      const profile = await database.exportProfile()
      if (!profile) {
        throw new Error('profile-not-found')
      }
      const result = await operation(profile.revision, new Date().toISOString())
      if (result.state === 'committed') {
        await refreshAfterMutation()
        setFeedback({
          body: copy.successBody,
          title: copy.successTitle,
          tone: 'success'
        })
        return true
      }
      setFeedback({
        body: copy.errorBody,
        title: copy.errorTitle,
        tone: result.state === 'pending' ? 'info' : 'error'
      })
      await load()
      return false
    } catch {
      setFeedback({
        body: copy.errorBody,
        title: copy.errorTitle,
        tone: 'error'
      })
      return false
    } finally {
      setPending(false)
    }
  }

  const togglePaused = (subscription: RssSubscription) => {
    void mutate((expectedRevision, at) =>
      service.setPaused({
        operationId: `operation:rss:state:${crypto.randomUUID()}`,
        expectedRevision,
        feedId: subscription.feedId,
        paused: subscription.state === 'active',
        at
      })
    )
  }

  const handleTogglePaused = (event: MouseEvent<HTMLButtonElement>) => {
    const subscription = subscriptions.find(
      ({ feedId }) => feedId === event.currentTarget.dataset.feedId
    )
    if (subscription) {
      togglePaused(subscription)
    }
  }

  const confirmRemove = () => {
    if (!removeFeedId) {
      return
    }
    const feedId = removeFeedId
    void mutate((expectedRevision, at) =>
      service.remove({
        operationId: `operation:rss:remove:${crypto.randomUUID()}`,
        expectedRevision,
        feedId,
        confirmed: true,
        at
      })
    ).then(async committed => {
      if (committed) {
        await notifyRemoved(feedId).catch(() =>
          setFeedback({
            body: copy.errorBody,
            title: copy.errorTitle,
            tone: 'degraded'
          })
        )
        setRemoveFeedId(undefined)
      }
    })
  }

  const beginRemove = (event: MouseEvent<HTMLButtonElement>) => {
    setRemoveFeedId(event.currentTarget.dataset.feedId)
  }

  const cancelRemove = () => {
    setRemoveFeedId(undefined)
  }

  const stateByFeed = new Map(runtimeStates.map(state => [state.feedId, state]))
  const statusLabel = (
    subscription: RssSubscription,
    state: RssRuntimeState | undefined
  ) => {
    if (subscription.state === 'paused') {
      return copy.pausedStatus
    }
    switch (state?.state) {
      case 'ready':
        return copy.statusReady
      case 'fetching':
        return copy.statusFetching
      case 'failed':
        return copy.statusFailed
      case 'unavailable':
        return copy.statusUnavailable
      case 'scheduled':
        return copy.statusScheduled
      case 'idle':
        return copy.statusIdle
      default:
        return copy.statusNotChecked
    }
  }
  const heading = (
    <div className="feed-panel__heading">
      <p>{copy.eyebrow}</p>
      <h2>{copy.title}</h2>
      <span>{copy.description}</span>
    </div>
  )

  return (
    <section aria-busy={pending} className="feed-panel" data-slot="feed-panel">
      {onBack && backLabel ? (
        <div data-slot="subpage-header">
          <BackAction label={backLabel} onClick={onBack} />
          {heading}
        </div>
      ) : (
        heading
      )}
      <Notice
        body={copy.browserUnavailableBody}
        title={copy.browserUnavailableTitle}
        tone="degraded"
      />
      <p className="feed-panel__availability">{copy.browserPortableNote}</p>
      {feedback ? (
        <Notice
          body={feedback.body}
          title={feedback.title}
          tone={feedback.tone}
        />
      ) : null}
      {subscriptions.length === 0 ? (
        <Surface tone="subtle">
          <div className="feed-panel__empty">
            <strong>{copy.emptyTitle}</strong>
            <span>{copy.emptyBody}</span>
          </div>
        </Surface>
      ) : (
        <div className="feed-list">
          {subscriptions.map(subscription => {
            const runtimeState = stateByFeed.get(subscription.feedId)
            return (
              <Surface key={subscription.feedId}>
                <article className="feed-card">
                  <div className="feed-card__heading">
                    <Badge tone={statusTone(subscription, runtimeState)}>
                      {statusLabel(subscription, runtimeState)}
                    </Badge>
                    <strong>{subscription.origin}</strong>
                    <span className="feed-card__url">{subscription.url}</span>
                    <span>
                      {subscription.intervalMinutes} {copy.intervalSuffix}
                    </span>
                  </div>
                  {removeFeedId === subscription.feedId ? (
                    <div className="feed-card__review">
                      <Notice
                        body={copy.removeReviewBody}
                        title={copy.removeReviewTitle}
                        tone="degraded"
                      />
                      <div className="feed-panel__actions">
                        <Button
                          disabled={pending}
                          onClick={confirmRemove}
                          size="compact"
                          variant="danger"
                        >
                          {copy.removeAction}
                        </Button>
                        <Button
                          disabled={pending}
                          onClick={cancelRemove}
                          size="compact"
                          variant="quiet"
                        >
                          {copy.cancelAction}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="feed-card__actions">
                      <Button
                        disabled={pending}
                        data-feed-id={subscription.feedId}
                        onClick={handleTogglePaused}
                        size="compact"
                        variant="quiet"
                      >
                        {subscription.state === 'paused'
                          ? copy.resumeAction
                          : copy.pauseAction}
                      </Button>
                      <Button
                        disabled={pending}
                        data-feed-id={subscription.feedId}
                        onClick={beginRemove}
                        size="compact"
                        variant="danger"
                      >
                        {copy.removeAction}
                      </Button>
                    </div>
                  )}
                </article>
              </Surface>
            )
          })}
        </div>
      )}
    </section>
  )
}
