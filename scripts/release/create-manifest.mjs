import { writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  artifactNames,
  assertRegularFile,
  getPackage,
  parseArgs,
  sha256File,
  stableJson
} from './lib.mjs'

export const createReleaseManifest = async ({
  root,
  directory,
  channel,
  gitState
}) => {
  const product = await getPackage(root)
  const artifacts = []
  for (const name of artifactNames(product.version)) {
    const path = resolve(directory, name)
    await assertRegularFile(path)
    artifacts.push({
      name,
      browser: name.includes('chrome')
        ? 'chrome'
        : name.includes('firefox')
          ? 'firefox'
          : 'sources',
      sha256: await sha256File(path)
    })
  }
  return {
    schemaVersion: 1,
    product: { name: product.name, version: product.version },
    channel,
    source: {
      commit: gitState.commit,
      tag: gitState.tag || null,
      branch: gitState.branch || null,
      dirty: gitState.dirty
    },
    toolchain: {
      node: process.version,
      pnpm: product.packageManager,
      wxt: product.devDependencies.wxt,
      operatingSystem: `${process.platform}-${process.arch}`
    },
    versionDomains: {
      profileSchema: '1.3',
      settingsSchema: 1,
      indexedDb: 6,
      adapterContract: '1.0.0',
      providerStateSchema: 1
    },
    inputs: {
      lockfile: {
        name: 'pnpm-lock.yaml',
        sha256: await sha256File(resolve(root, 'pnpm-lock.yaml'))
      },
      workflow: process.env.GITHUB_WORKFLOW_REF || null
    },
    capabilities: {
      deterministicFiltering: 'candidate',
      textClassification: 'candidate',
      visualAssistance: 'candidate',
      localSimilarity: 'candidate',
      nativePlatformFeedback: 'disabled-unavailable'
    },
    providers: [],
    models: [],
    datasets: [],
    classifier: {
      version: '1',
      archetypes: ['rage-bait', 'clickbait', 'misinformation', 'distraction']
    },
    artifacts,
    gates: {
      automated: 'pending-verification',
      humanAccessibilityMatrix: 'required',
      signedPackageInstallAndUpdate: 'required',
      storeApproval: 'required'
    },
    reproducibility: { allowedNondeterministicFields: [] }
  }
}

export const writeReleaseManifest = async options => {
  const manifest = await createReleaseManifest(options)
  const output = resolve(options.directory, 'release-manifest.json')
  await writeFile(output, stableJson(manifest), { flag: 'wx' })
  return { manifest, output: basename(output) }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2))
  if (
    typeof args.directory !== 'string' ||
    typeof args.channel !== 'string' ||
    typeof args.commit !== 'string'
  ) {
    throw new Error(
      'Usage: create-manifest.mjs --directory <path> --channel <channel> --commit <sha> [--tag <tag>] [--branch <branch>] [--dirty]'
    )
  }
  await writeReleaseManifest({
    root: process.cwd(),
    directory: resolve(args.directory),
    channel: args.channel,
    gitState: {
      commit: args.commit,
      tag: typeof args.tag === 'string' ? args.tag : '',
      branch: typeof args.branch === 'string' ? args.branch : '',
      dirty: args.dirty === true
    }
  })
  console.log(`Wrote release manifest in ${args.directory}.`)
}
