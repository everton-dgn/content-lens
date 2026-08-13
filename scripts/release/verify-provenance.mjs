import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { guardReleaseDirectory } from './guard-artifact.mjs'
import { parseArgs, run } from './lib.mjs'

export const verifyProvenance = async ({
  root,
  directory,
  repository,
  requireAttestation = false
}) => {
  const { manifest } = await guardReleaseDirectory({ root, directory })
  if (requireAttestation) {
    if (!repository)
      throw new Error(
        'Public provenance verification requires --repository owner/repository.'
      )
    for (const artifact of manifest.artifacts) {
      run(
        'gh',
        [
          'attestation',
          'verify',
          resolve(directory, artifact.name),
          '--repo',
          repository
        ],
        { cwd: root }
      )
    }
  }
  return manifest
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2))
  if (typeof args.directory !== 'string')
    throw new Error(
      'Usage: verify-provenance.mjs --directory <path> [--repository owner/repository] [--require-attestation]'
    )
  const directory = resolve(args.directory)
  const manifest = await verifyProvenance({
    root: process.cwd(),
    directory,
    repository: typeof args.repository === 'string' ? args.repository : '',
    requireAttestation: args['require-attestation'] === true
  })
  console.log(
    `Verified provenance for ${manifest.product.name} ${manifest.product.version}.`
  )
}
