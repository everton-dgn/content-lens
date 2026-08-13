import { defineConfig } from 'wxt'

export const firefoxRuntimeExtensionId =
  '{74780624-e313-43b5-8558-799bbf9b95d3}'

export default defineConfig({
  srcDir: 'tests/browser/harness/runtime/extension',
  outDir: '.output/runtime-feasibility',
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
  manifest: ({ browser }) => ({
    name: 'ContentLens runtime feasibility',
    description:
      'Isolated packaged build for lifecycle and capability evidence.',
    version: '0.0.0',
    default_locale: 'en',
    permissions: [],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: firefoxRuntimeExtensionId,
              data_collection_permissions: {
                required: ['none']
              }
            }
          }
        }
      : {})
  })
})
