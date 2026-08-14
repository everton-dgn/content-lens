import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  stat,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { guardBundleDirectory } from '../ci/bundle-size-guard.ts'
import { writeReleaseManifest } from './create-manifest.mjs'
import { writeProvenance } from './create-provenance.mjs'
import { generateSbom } from './generate-sbom.mjs'
import {
  artifactNames,
  assertRegularFile,
  getPackage,
  git,
  parseArgs,
  RELEASE_FILES,
  run,
  sha256File,
  validateRelease
} from './lib.mjs'

export const writeChecksums = async directory => {
  const names = (await readdir(directory))
    .filter(name => name !== RELEASE_FILES.checksums)
    .sort()
  const lines = []
  for (const name of names) {
    await assertRegularFile(resolve(directory, name))
    lines.push(`${await sha256File(resolve(directory, name))}  ${name}`)
  }
  await writeFile(
    resolve(directory, RELEASE_FILES.checksums),
    `${lines.join('\n')}\n`,
    { flag: 'wx' }
  )
}

const collectPaths = async (root, relative = '') => {
  const directory = resolve(root, relative)
  const entries = (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name)
  )
  const paths = []
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name
    paths.push(path)
    if (entry.isDirectory()) paths.push(...(await collectPaths(root, path)))
  }
  return paths
}

export const normalizeZip = async ({ source, target, created }) => {
  const workspace = await mkdtemp(join(tmpdir(), 'content-lens-release-'))
  run('unzip', ['-qq', source, '-d', workspace], { capture: true })
  const timestamp = new Date(created)
  const paths = await collectPaths(workspace)
  for (const path of paths) {
    const absolute = resolve(workspace, path)
    const details = await stat(absolute)
    await chmod(absolute, details.isDirectory() ? 0o755 : 0o644)
    await utimes(absolute, timestamp, timestamp)
  }
  run('zip', ['-X', '-q', target, ...paths], {
    cwd: workspace,
    capture: true,
    env: { TZ: 'UTC' }
  })
}

export const packageRelease = async ({
  root,
  channel,
  output,
  allowDirty = false,
  skipBuild = false
}) => {
  const product = await getPackage(root)
  const gitState = validateRelease({
    root,
    channel,
    version: product.version,
    allowDirty
  })
  const created = git(root, 'show', '-s', '--format=%cI', gitState.commit)
  if (await stat(output).catch(() => null)) {
    throw new Error(`Release output already exists: ${output}`)
  }
  await mkdir(output, { recursive: true })

  if (!skipBuild) {
    run('pnpm', ['exec', 'wxt', 'zip', '-b', 'chrome'], { cwd: root })
    run('pnpm', ['exec', 'wxt', 'zip', '-b', 'firefox'], { cwd: root })
  }

  await Promise.all(
    ['chrome-mv3', 'firefox-mv2'].map(bundle =>
      guardBundleDirectory(resolve(root, '.output', bundle))
    )
  )

  for (const name of artifactNames(product.version)) {
    const source = resolve(root, '.output', name)
    await assertRegularFile(source)
    await normalizeZip({ source, target: resolve(output, name), created })
  }

  await generateSbom({
    root,
    output: resolve(output, RELEASE_FILES.sbom),
    commit: gitState.commit,
    created
  })
  await writeReleaseManifest({ root, directory: output, channel, gitState })
  await writeProvenance({ directory: output })
  await writeChecksums(output)
  return { directory: output, gitState, version: product.version }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2))
  const channel = typeof args.channel === 'string' ? args.channel : 'dev'
  const product = await getPackage(process.cwd())
  const output = resolve(
    typeof args.output === 'string'
      ? args.output
      : `.release/content-lens-${product.version}-${channel}`
  )
  const result = await packageRelease({
    root: process.cwd(),
    channel,
    output,
    allowDirty: args['allow-dirty'] === true,
    skipBuild: args['skip-build'] === true
  })
  console.log(
    `Release package ${result.version} created at ${result.directory}.`
  )
}
