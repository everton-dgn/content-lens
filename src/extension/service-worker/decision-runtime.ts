import { DecisionScheduler } from '@/application/decision-pipeline/scheduler'

export const SERVICE_WORKER_QUEUE_CAPACITY = 64
export const SERVICE_WORKER_QUEUE_CONCURRENCY = 4

export function createServiceWorkerDecisionScheduler() {
  return new DecisionScheduler({
    capacity: SERVICE_WORKER_QUEUE_CAPACITY,
    concurrency: SERVICE_WORKER_QUEUE_CONCURRENCY,
    maximumAttempts: 2,
    circuit: {
      failureThreshold: 3,
      cooldownMs: 30_000
    }
  })
}
