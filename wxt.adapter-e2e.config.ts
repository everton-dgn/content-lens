import { defineConfig } from 'wxt'

import { createManifest } from './src/config/manifest'

const youtubeMatch = 'https://www.youtube.com/*'

export default defineConfig({
  srcDir: 'src',
  outDir: '.output/adapter-e2e',
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
  targetBrowsers: ['chrome'],
  modules: ['@wxt-dev/module-react'],
  manifest: () => ({
    ...createManifest(),
    host_permissions: [youtubeMatch]
  })
})
