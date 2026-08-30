import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'tests/browser/harness/runtime/extension',
  outDir: '.output/runtime-feasibility',
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
  targetBrowsers: ['chrome'],
  manifest: {
    name: 'ContentLens runtime feasibility',
    description:
      'Isolated packaged build for lifecycle and capability evidence.',
    version: '0.0.0',
    default_locale: 'en',
    permissions: []
  }
})
