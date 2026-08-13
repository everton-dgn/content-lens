import { defineConfig } from 'wxt'

import { createManifest } from './src/config/manifest'

const youtubeMatch = 'https://www.youtube.com/*'

export default defineConfig({
  srcDir: 'src',
  outDir: '.output/adapter-e2e',
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => {
    const manifest = createManifest(browser)
    return browser === 'firefox'
      ? {
          ...manifest,
          permissions: [...(manifest.permissions ?? []), youtubeMatch]
        }
      : {
          ...manifest,
          host_permissions: [youtubeMatch]
        }
  }
})
