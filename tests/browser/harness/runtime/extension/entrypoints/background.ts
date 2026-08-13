import { runWorkerBenchmark } from '../../benchmark'
import { commitIndexedDbOperation } from '../../indexeddb-journal'
import {
  isRuntimeRequest,
  type RuntimeCommitObservedMessage,
  type RuntimeResponse
} from '../../messages'
import { probeExtensionCapabilities } from '../../runtime-capabilities'

const neverCompletes = (): Promise<never> =>
  new Promise(() => {
    // The packaged-browser test terminates this context after the commit signal.
  })

export default defineBackground({
  type: 'module',
  main() {
    browser.runtime.onMessage.addListener(
      async (message, sender): Promise<RuntimeResponse | undefined> => {
        if (!isRuntimeRequest(message)) {
          return undefined
        }

        if (message.type === 'phase0-runtime-capabilities') {
          return probeExtensionCapabilities()
        }

        if (message.type === 'phase0-runtime-benchmark') {
          return runWorkerBenchmark(message.candidateIds)
        }

        const committed = await commitIndexedDbOperation(
          message.operationId,
          message.effectId
        )

        if (message.mode === 'commit-then-hang') {
          if (sender.tab?.id !== undefined) {
            await browser.tabs.sendMessage(sender.tab.id, {
              operationId: message.operationId,
              type: 'phase0-runtime-commit-observed'
            } satisfies RuntimeCommitObservedMessage)
          }
          return neverCompletes()
        }

        return committed
      }
    )
  }
})
