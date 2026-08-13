import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { browser } from 'wxt/browser'

import {
  BROWSER_AI_PORT_NAME,
  type BrowserAiRuntimePort,
  startBrowserAiBridgeHost
} from '@/ai/browser/bridge'
import { createBrowserPromptExecutor } from '@/ai/browser/language-model'
import { getUiLanguage, t } from '@/i18n/runtime'
import { ThemeProvider } from '@/ui/styles/ThemeProvider'
import '@/ui/styles/globals.css'
import '@/ui/data/data-panel.css'
import '@/ui/feeds/feed-panel.css'
import '@/ui/home/home-panel.css'
import '@/ui/native-feedback/native-feedback.css'
import '@/ui/rules/rule-workbench.css'
import '@/ui/similarity/similarity-review.css'
import '@/ui/settings/settings-panel.css'

import { App } from './App'
import './styles.css'

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
