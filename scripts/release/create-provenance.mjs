import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseArgs, readJson, stableJson } from './lib.mjs'

export const createProvenance = ({ manifest, github = process.env }) => ({
  _type: 'https://in-toto.io/Statement/v1',
  subject: manifest.artifacts.map(artifact => ({
    name: artifact.name,
    digest: { sha256: artifact.sha256 }
  })),
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: {
    buildDefinition: {
      buildType: 'https://wxt.dev/buildtypes/extension/v1',
      externalParameters: {
        channel: manifest.channel,
        tag: manifest.source.tag
      },
      internalParameters: { toolchain: manifest.toolchain },
      resolvedDependencies: [
        {
          uri: `git+https://github.com/${github.GITHUB_REPOSITORY || 'content-lens/content-lens'}@${manifest.source.commit}`,
          digest: { gitCommit: manifest.source.commit }
        },
        {
          uri: 'pnpm-lock.yaml',
          digest: { sha256: manifest.inputs.lockfile.sha256 }
        }
      ]
    },
    runDetails: {
      builder: {
        id: github.GITHUB_WORKFLOW_REF || 'local:content-lens-release'
      },
      metadata: {
        invocationId: github.GITHUB_RUN_ID || `local-${manifest.source.commit}`,
        startedOn: null,
        finishedOn: null
      },
      byproducts: []
    }
  }
})

export const writeProvenance = async ({ directory }) => {
  const manifest = await readJson(resolve(directory, 'release-manifest.json'))
  const provenance = createProvenance({ manifest })
  await writeFile(
    resolve(directory, 'provenance.intoto.json'),
    stableJson(provenance),
    { flag: 'wx' }
  )
  return provenance
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2))
  if (typeof args.directory !== 'string')
    throw new Error('Usage: create-provenance.mjs --directory <path>')
  await writeProvenance({ directory: resolve(args.directory) })
  console.log(`Wrote in-toto provenance statement in ${args.directory}.`)
}
