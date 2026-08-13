import type {
  RuntimeCommitObservedMessage,
  RuntimeRequestMessage
} from '../../messages'
import { ReversibleCandidateRenderer } from '../../renderer'

const operationEvent = 'contentlens:runtime:operate'
const capabilityEvent = 'contentlens:runtime:probe'
const benchmarkEvent = 'contentlens:runtime:benchmark'
let benchmarkSequence = 0

const send = async (message: RuntimeRequestMessage): Promise<unknown> =>
  browser.runtime.sendMessage(message)

const writeResult = (result: unknown): void => {
  document.documentElement.dataset.contentlensRuntimeResult =
    JSON.stringify(result)
  document.documentElement.removeAttribute('data-contentlens-runtime-error')
}

const writeError = (error: unknown): void => {
  document.documentElement.dataset.contentlensRuntimeError =
    error instanceof Error ? error.message : 'runtime-request-failed'
}

const runOperation = async (): Promise<void> => {
  const root = document.documentElement
  const operationId = root.dataset.contentlensOperationId
  const mode = root.dataset.contentlensOperationMode

  if (!operationId || (mode !== 'commit' && mode !== 'commit-then-hang')) {
    writeError('invalid-operation-command')
    return
  }

  root.removeAttribute('data-contentlens-runtime-result')
  root.dataset.contentlensRuntimePending = operationId

  try {
    writeResult(
      await send({
        effectId: `effect-${operationId}`,
        mode,
        operationId,
        type: 'phase0-runtime-operation'
      })
    )
  } catch (error) {
    writeError(error)
  } finally {
    root.removeAttribute('data-contentlens-runtime-pending')
  }
}

const runCapabilityProbe = async (): Promise<void> => {
  try {
    writeResult(await send({ type: 'phase0-runtime-capabilities' }))
  } catch (error) {
    writeError(error)
  }
}

const runPageBenchmark = async (): Promise<void> => {
  const root = document.documentElement
  const cards = [...document.querySelectorAll('[data-runtime-card]')]
  const renderer = new ReversibleCandidateRenderer()
  const acknowledgement = document.querySelector<HTMLElement>(
    '[data-runtime-acknowledgement]'
  )
  const acknowledgedAt = performance.now()
  benchmarkSequence += 1
  root.dataset.contentlensRuntimePending = 'benchmark'
  if (acknowledgement) {
    acknowledgement.hidden = false
    acknowledgement.textContent = `Benchmark started ${benchmarkSequence}`
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  const acknowledgementMs = performance.now() - acknowledgedAt
  const pageStartedAt = performance.now()
  const renderRestoreDurations: number[] = []

  cards.forEach((card, index) => {
    const cardStartedAt = performance.now()
    renderer.hide(card, {
      pageInstanceId: `benchmark:${index}`,
      reason: 'Benchmark rule'
    })
    renderer.restore(card)
    renderRestoreDurations.push(performance.now() - cardStartedAt)
  })
  const pageMainThreadMs = performance.now() - pageStartedAt
  const roundTripStartedAt = performance.now()

  try {
    const worker = await send({
      candidateIds: cards.map(
        card => card.getAttribute('data-runtime-card') ?? ''
      ),
      type: 'phase0-runtime-benchmark'
    })
    writeResult({
      acknowledgementMs,
      cardCount: cards.length,
      pageMainThreadMs,
      renderRestorePerCardMs: Math.max(0, ...renderRestoreDurations),
      roundTripMs: performance.now() - roundTripStartedAt,
      worker
    })
  } catch (error) {
    writeError(error)
  } finally {
    root.removeAttribute('data-contentlens-runtime-pending')
  }
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    const root = document.documentElement
    if (root.dataset.contentlensFeasibility !== 'runtime') {
      return
    }

    document.addEventListener(operationEvent, () => {
      void runOperation()
    })
    document.addEventListener(capabilityEvent, () => {
      void runCapabilityProbe()
    })
    document.addEventListener(benchmarkEvent, () => {
      void runPageBenchmark()
    })
    document
      .querySelector('[data-runtime-benchmark-trigger]')
      ?.addEventListener('click', () => {
        void runPageBenchmark()
      })
    browser.runtime.onMessage.addListener((message: unknown) => {
      const observed = message as Partial<RuntimeCommitObservedMessage>
      if (
        observed.type === 'phase0-runtime-commit-observed' &&
        typeof observed.operationId === 'string'
      ) {
        root.dataset.contentlensRuntimeCommitted = observed.operationId
      }
    })

    root.dataset.contentlensRuntimeReady = import.meta.env.BROWSER
  }
})
