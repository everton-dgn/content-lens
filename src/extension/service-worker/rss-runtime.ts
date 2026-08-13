import type { RssAcquisitionResult, RssRuntimeState } from '@/adapters/rss'
import {
  RssAcquisitionQueue,
  RssAcquisitionService,
  RssRuntimeCoordinator,
  readRssSubscriptions
} from '@/application/feed-subscriptions'
import type { ProfileEnvelope } from '@/storage/contracts/profile-envelope'

export type RssRuntimeDatabase = {
  exportProfile(): Promise<ProfileEnvelope | undefined>
  readRssRuntimeStates(): Promise<RssRuntimeState[]>
  replaceRssRuntimeState(state: RssRuntimeState): Promise<void>
}

export type ServiceWorkerRssRuntime = {
  cancel(feedId: string): Promise<boolean>
  revalidate(feedId: string): Promise<RssAcquisitionResult>
  runDue(): Promise<RssAcquisitionResult[]>
  start(): Promise<RssAcquisitionResult[]>
}

export function createServiceWorkerRssRuntime(options: {
  database: RssRuntimeDatabase
  jitter?: () => number
  now?: () => Date
}): ServiceWorkerRssRuntime {
  const cancelledFeedIds = new Set<string>()
  const acquisition = new RssAcquisitionService({
    ...(options.now ? { now: options.now } : {})
  })
  const coordinator = new RssRuntimeCoordinator({
    queue: new RssAcquisitionQueue({
      acquire: input => acquisition.acquire(input)
    }),
    persistence: {
      read: () => options.database.readRssRuntimeStates(),
      write: state =>
        cancelledFeedIds.has(state.feedId)
          ? Promise.resolve()
          : options.database.replaceRssRuntimeState(state)
    },
    ...(options.jitter ? { jitter: options.jitter } : {}),
    ...(options.now ? { now: options.now } : {})
  })
  let runInFlight: Promise<RssAcquisitionResult[]> | undefined

  const runDue = () => {
    if (runInFlight) {
      return runInFlight
    }
    runInFlight = options.database
      .exportProfile()
      .then(profile =>
        coordinator.runDue(
          profile ? readRssSubscriptions(profile.settings) : []
        )
      )
      .finally(() => {
        runInFlight = undefined
      })
    return runInFlight
  }

  return {
    cancel: async feedId => {
      cancelledFeedIds.add(feedId)
      return coordinator.cancel(feedId)
    },
    revalidate: async feedId => {
      const profile = await options.database.exportProfile()
      const subscription = profile
        ? readRssSubscriptions(profile.settings).find(
            candidate => candidate.feedId === feedId
          )
        : undefined
      if (!subscription) {
        return {
          state: 'failed',
          feedId,
          code: 'unexpected-failure',
          durationMs: 0
        }
      }
      return coordinator.run(subscription)
    },
    runDue,
    start: runDue
  }
}
