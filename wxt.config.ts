import { defineConfig } from 'wxt'

import { createManifest } from './src/config/manifest'

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => createManifest(browser),
  zip: {
    dotSources: true,
    includeSources: [
      '.node-version',
      'CONTRIBUTING.md',
      'LICENSE',
      'README.md',
      'SOURCE_CODE_REVIEW.md',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'postcss.config.mjs',
      'public/**',
      'src/**',
      'tsconfig.json',
      'wxt.config.ts'
    ]
  }
})
