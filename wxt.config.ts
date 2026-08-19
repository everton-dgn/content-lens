import { readFile } from 'node:fs/promises'

import { defineConfig } from 'wxt'

import { renderLeanCatalog } from './scripts/build/lean-locales'
import { createManifest } from './src/config/manifest'

const messagesAsset = /^_locales[/\\][^/\\]+[/\\]messages\.json$/u

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => createManifest(browser),
  hooks: {
    /**
     * The repository catalogs carry a `description` per message for
     * translators, which no browser reads. Trimming here rather than in a
     * build script keeps every packaged output identical, including the ones
     * the browser tests install.
     */
    'build:publicAssets': async (_wxt, assets) => {
      for (const [index, asset] of assets.entries()) {
        if (
          !('absoluteSrc' in asset) ||
          !messagesAsset.test(asset.relativeDest)
        ) {
          continue
        }
        const original = JSON.parse(
          await readFile(asset.absoluteSrc, 'utf8')
        ) as unknown

        assets[index] = {
          contents: renderLeanCatalog(original),
          relativeDest: asset.relativeDest
        }
      }
    }
  },
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
