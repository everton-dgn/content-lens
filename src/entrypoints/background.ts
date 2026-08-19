import { browser } from 'wxt/browser'

import {
  configurePanelAction,
  type SupportedBrowser
} from '@/adapters/browser/panel'
import { installedAdapterOriginMap } from '@/adapters/registry'
import {
  BROWSER_AI_PORT_NAME,
  type BrowserAiRuntimePort
} from '@/ai/browser/bridge'
import {
  type AdapterControlPort,
  AdapterRuntimeControlHub
} from '@/application/adapter-activation/runtime-control'
import { createRuntimeMessageListener } from '@/application/messages/runtime'
import type { BrowserPermissionsApi } from '@/application/provider-management/browser-permissions'
import { createServiceWorkerRuntime } from '@/extension/service-worker/runtime'
import { applyInterfaceLocale } from '@/i18n/load'
import { getInjectedOverlayCopy } from '@/i18n/overlay-copy'

const isSupportedBrowser = (
  browserName: string
): browserName is SupportedBrowser =>
  browserName === 'chrome' || browserName === 'firefox'

export default defineBackground({
  type: 'module',
  main() {
    const browserName = import.meta.env.BROWSER

    if (!isSupportedBrowser(browserName)) {
      return
    }
    void configurePanelAction(browserName)

    const adapterControl = new AdapterRuntimeControlHub({
      extensionId: browser.runtime.id,
      originMap: installedAdapterOriginMap
    })
    const runtime = createServiceWorkerRuntime({
      alarmsApi: browser.alarms,
      browser: browserName,
      permissionApi: browser.permissions as unknown as BrowserPermissionsApi,
      scriptingApi: browser.scripting,
      async onAdapterActivationReconciled({
        enabledSurfaces,
        locale,
        results
      }) {
        // Overlay copy is resolved here, so the stored language has to be
        // applied before the control port publishes it.
        await applyInterfaceLocale(locale)
        adapterControl.publish(
          results,
          getInjectedOverlayCopy(),
          enabledSurfaces
        )
      }
    })
    void runtime.rss.start().catch(() => undefined)
    void runtime.sync.start().catch(() => undefined)
    browser.alarms.onAlarm.addListener(alarm => {
      void runtime.sync.handleAlarm(alarm).catch(() => undefined)
    })
    const reconcileAdapterActivation = () => {
      void runtime.reconcileAdapterActivation().catch(() => undefined)
    }
    reconcileAdapterActivation()
    browser.permissions.onAdded.addListener(() => {
      reconcileAdapterActivation()
      void runtime.rss.runDue().catch(() => undefined)
    })
    browser.permissions.onRemoved.addListener(() => {
      reconcileAdapterActivation()
    })
    const messageListener = createRuntimeMessageListener({
      extensionPageUrls: [browser.runtime.getURL('/sidepanel.html')],
      extensionId: browser.runtime.id,
      originMap: installedAdapterOriginMap,
      onDecisionRequest: message => runtime.decisions.decide(message),
      onRssCancel: feedId => runtime.rss.cancel(feedId),
      onRssRevalidate: feedId => runtime.rss.revalidate(feedId),
      onSettingsRequest: message => runtime.settings.handle(message)
    })
    browser.runtime.onMessage.addListener((message, sender, sendResponse) =>
      messageListener(message, sender, sendResponse)
    )
    browser.runtime.onConnect.addListener(port => {
      if (adapterControl.attach(port as unknown as AdapterControlPort)) {
        return
      }
      const sender = port.sender
      if (
        port.name !== BROWSER_AI_PORT_NAME ||
        sender?.id !== browser.runtime.id ||
        !sender.url?.startsWith(browser.runtime.getURL('/'))
      ) {
        return
      }
      runtime.browserAiBridge.attach(port as unknown as BrowserAiRuntimePort)
    })
  }
})
