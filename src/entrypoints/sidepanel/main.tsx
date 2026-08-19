import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { browser } from 'wxt/browser'

import {
  BROWSER_AI_PORT_NAME,
  type BrowserAiRuntimePort,
  startBrowserAiBridgeHost
} from '@/ai/browser/bridge'
import { createBrowserPromptExecutor } from '@/ai/browser/language-model'
import { applyInterfaceLocale } from '@/i18n/load'
import { getUiLanguage, t } from '@/i18n/runtime'
import { browserSettingsRuntime } from '@/ui/settings/runtime'
import { ThemeProvider } from '@/ui/styles/ThemeProvider'
import '@/ui/styles/globals.css'
import '@/ui/data/data-panel.css'
import '@/ui/feeds/feed-panel.css'
import '@/ui/home/home-panel.css'
import '@/ui/native-feedback/native-feedback.css'
import '@/ui/rules/rule-workbench.css'
import '@/ui/similarity/similarity-review.css'
import '@/ui/settings/settings-panel.css'

import './styles.css'

/**
 * The stored language has to be applied before any module reads a message,
 * because copy is resolved eagerly at import time. An unreadable profile keeps
 * the browser-resolved language rather than blocking the panel.
 */
const bootstrapLocale = async () => {
  let stored = 'auto'

  try {
    const response = await browserSettingsRuntime.request({
      type: 'settings.snapshot'
    })

    if (response.kind === 'snapshot') {
      stored = response.value.settings.settings.interface.locale
    }
  } catch {
    // A profile that cannot be read yet still deserves the automatic choice.
  }
  await applyInterfaceLocale(stored)
}

await bootstrapLocale()

const { App } = await import('./App')

document.documentElement.lang = getUiLanguage()
document.title = t('extensionName')

const browserAiHost = startBrowserAiBridgeHost({
  port: browser.runtime.connect({
    name: BROWSER_AI_PORT_NAME
  }) as unknown as BrowserAiRuntimePort,
  executor: createBrowserPromptExecutor({})
})
globalThis.addEventListener(
  'pagehide',
  () => {
    browserAiHost.dispose()
  },
  { once: true }
)

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('ContentLens side panel root was not found.')
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
)
