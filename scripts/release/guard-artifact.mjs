import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { runPublicGuard } from '../ci/public-guard.ts'
import {
  artifactNames,
  getPackage,
  parseArgs,
  RELEASE_FILES,
  readJson,
  sha256File
} from './lib.mjs'

const unzipEntry = (archive, entry) => {
  const result = spawnSync('unzip', ['-p', archive, entry], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  })
  if (result.status !== 0)
    throw new Error(`Cannot read ${entry} from ${archive}.`)
  return result.stdout
}

const unzipEntryBuffer = (archive, entry) => {
  const result = spawnSync('unzip', ['-p', archive, entry], {
    maxBuffer: 20 * 1024 * 1024
  })
  if (result.status !== 0)
    throw new Error(`Cannot read ${entry} from ${archive}.`)
  return result.stdout
}

const listArchive = archive => {
  const result = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`Cannot list ${archive}.`)
  return result.stdout.split('\n').filter(Boolean)
}

const packagedHttpsHosts = new Set([
  'api.anthropic.com',
  'api.openai.com',
  'browser-ai.contentlens.invalid',
  'generativelanguage.googleapis.com',
  'invalid.invalid',
  'json-schema.org',
  'news.ycombinator.com',
  'openai.com',
  'policies.google.com',
  'privacy.anthropic.com',
  'react.dev',
  'www.linkedin.com',
  'www.reddit.com',
  'www.youtube.com',
  'x.com'
])

const allowedPackagedUrl = raw => {
  if (
    raw === ['http', '://*/*'].join('') ||
    raw === ['https', '://*/*'].join('') ||
    raw === ['http', '://127', '.0.0.1:11434'].join('') ||
    raw.startsWith(['http', '://[${'].join('')) ||
    raw.startsWith(['http', '://json-schema.org/'].join('')) ||
    raw.startsWith(['http', '://www.w3.org/'].join(''))
  ) {
    return true
  }
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      packagedHttpsHosts.has(url.hostname)
    )
  } catch {
    return false
  }
}

export const findUnreviewedNetworkLiterals = (entry, content) => {
  const executableContent = entry.endsWith('.css')
    ? content.replace(/\/\*[\s\S]*?\*\//gu, '')
    : content

  return [...executableContent.matchAll(/https?:\/\/[^\s<>"'`\\)]+/gu)]
    .map(match => match[0].replace(/[),.;:]+$/u, ''))
    .filter(raw => !allowedPackagedUrl(raw))
}

const validateBundleNetworkLiterals = archive => {
  const textEntries = listArchive(archive).filter(entry =>
    /\.(?:css|html|js|json)$/u.test(entry)
  )
  for (const entry of textEntries) {
    const content = unzipEntry(archive, entry)
    for (const raw of findUnreviewedNetworkLiterals(entry, content)) {
      throw new Error(
        `Unreviewed network literal in ${basename(archive)}!/${entry}: ${raw}`
      )
    }
    if (
      /(?:importScripts|new\s+Worker|new\s+SharedWorker)\s*\(\s*["']https?:/u.test(
        content
      ) ||
      /<script[^>]+src=["']https?:/iu.test(content)
    ) {
      throw new Error(
        `Remote executable code reference in ${basename(archive)}!/${entry}.`
      )
    }
  }
}

const validateBrowserManifest = (
  archive,
  browser,
  version,
  generatedIconManifest
) => {
  const manifest = JSON.parse(unzipEntry(archive, 'manifest.json'))
  if (manifest.version !== version)
    throw new Error(`${browser} manifest version does not match ${version}.`)
  if (manifest.manifest_version !== (browser === 'chrome' ? 3 : 2)) {
    throw new Error(`${browser} uses an unexpected manifest version.`)
  }
  const expectedPermissions =
    browser === 'chrome'
      ? ['alarms', 'sidePanel', 'scripting']
      : ['alarms', 'scripting']
  if (
    JSON.stringify(manifest.permissions?.sort()) !==
    JSON.stringify(expectedPermissions.sort())
  ) {
    throw new Error(`${browser} permissions differ from the reviewed contract.`)
  }
  const serialized = JSON.stringify(manifest)
  if (/https?:\/\/[^*]/u.test(String(manifest.content_security_policy ?? ''))) {
    throw new Error(`${browser} CSP permits remote code.`)
  }
  if (/"(?:background|content_scripts)"[\s\S]*https?:\/\//u.test(serialized)) {
    throw new Error(`${browser} manifest references remote executable code.`)
  }
  const entries = listArchive(archive)
  if (entries.some(entry => entry.endsWith('.map')))
    throw new Error(`${browser} archive contains source maps.`)
  for (const locale of ['en', 'pt_BR', 'es']) {
    if (!entries.includes(`_locales/${locale}/messages.json`))
      throw new Error(`${browser} is missing locale ${locale}.`)
  }
  for (const size of [16, 20, 24, 32, 48, 64, 128]) {
    const entry = `icon/${size}.png`
    if (!entries.includes(entry))
      throw new Error(`${browser} is missing icon ${size}.`)
    const expectedSha256 = generatedIconManifest.icons?.[size]?.sha256
    const actualSha256 = createHash('sha256')
      .update(unzipEntryBuffer(archive, entry))
      .digest('hex')
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `${browser} icon ${size} differs from the canonical generated asset.`
      )
    }
  }
}

export const parseChecksums = content =>
  new Map(
    content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const match = line.match(/^([a-f0-9]{64}) {2}([^/]+)$/u)
        if (!match) throw new Error(`Invalid checksum line: ${line}`)
        return [match[2], match[1]]
      })
  )

export const guardReleaseDirectory = async ({ root, directory }) => {
  const product = await getPackage(root)
  const generatedIconManifest = await readJson(
    resolve(root, 'scripts/brand/icons.generated.json')
  )
  const expectedArchives = artifactNames(product.version)
  const expectedFiles = [
    ...expectedArchives,
    ...Object.values(RELEASE_FILES)
  ].sort()
  const files = (await readdir(directory)).sort()
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Release must contain exactly: ${expectedFiles.join(', ')}.`
    )
  }
  for (const evidence of Object.values(RELEASE_FILES)) {
    if (!files.includes(evidence))
      throw new Error(`Release evidence is missing: ${evidence}.`)
  }

  const checksums = parseChecksums(
    await readFile(resolve(directory, RELEASE_FILES.checksums), 'utf8')
  )
  for (const name of files.filter(item => item !== RELEASE_FILES.checksums)) {
    if (checksums.get(name) !== (await sha256File(resolve(directory, name)))) {
      throw new Error(`Checksum mismatch for ${name}.`)
    }
  }
  if (checksums.size !== files.length - 1)
    throw new Error('Checksum inventory contains missing or extra entries.')

  const manifest = await readJson(resolve(directory, RELEASE_FILES.manifest))
  if (
    manifest.product?.version !== product.version ||
    manifest.product?.name !== product.name
  ) {
    throw new Error('Release manifest product identity is invalid.')
  }
  for (const artifact of manifest.artifacts ?? []) {
    if (
      !expectedArchives.includes(artifact.name) ||
      artifact.sha256 !== (await sha256File(resolve(directory, artifact.name)))
    ) {
      throw new Error(
        `Release manifest digest is invalid for ${artifact.name}.`
      )
    }
  }
  if (manifest.artifacts?.length !== 3)
    throw new Error('Release manifest must describe three artifacts.')

  const sbom = await readJson(resolve(directory, RELEASE_FILES.sbom))
  if (
    sbom.spdxVersion !== 'SPDX-2.3' ||
    sbom.SPDXID !== 'SPDXRef-DOCUMENT' ||
    !Array.isArray(sbom.packages)
  ) {
    throw new Error('SBOM is not a valid SPDX 2.3 document.')
  }
  const provenance = await readJson(
    resolve(directory, RELEASE_FILES.provenance)
  )
  if (
    provenance._type !== 'https://in-toto.io/Statement/v1' ||
    provenance.predicateType !== 'https://slsa.dev/provenance/v1'
  ) {
    throw new Error('Provenance is not an in-toto SLSA v1 statement.')
  }
  const subjects = new Map(
    provenance.subject?.map(subject => [subject.name, subject.digest?.sha256])
  )
  for (const artifact of manifest.artifacts) {
    if (subjects.get(artifact.name) !== artifact.sha256)
      throw new Error(`Provenance subject mismatch for ${artifact.name}.`)
  }

  validateBrowserManifest(
    resolve(directory, expectedArchives[0]),
    'chrome',
    product.version,
    generatedIconManifest
  )
  validateBundleNetworkLiterals(resolve(directory, expectedArchives[0]))
  validateBundleNetworkLiterals(resolve(directory, expectedArchives[1]))
  validateBrowserManifest(
    resolve(directory, expectedArchives[1]),
    'firefox',
    product.version,
    generatedIconManifest
  )
  const sourceEntries = listArchive(resolve(directory, expectedArchives[2]))
  for (const required of [
    'SOURCE_CODE_REVIEW.md',
    'package.json',
    'pnpm-lock.yaml',
    'wxt.config.ts'
  ]) {
    if (!sourceEntries.includes(required))
      throw new Error(`Sources archive is missing ${required}.`)
  }
  if (
    sourceEntries.some(
      entry =>
        entry.startsWith('.git/') ||
        entry.startsWith('.output/') ||
        entry.startsWith('.release/')
    )
  ) {
    throw new Error('Sources archive contains local or generated files.')
  }

  const findings = await runPublicGuard(
    root,
    expectedArchives.map(name => resolve(directory, name))
  )
  const blockingFindings = findings.filter(finding => {
    const browserBundle =
      finding.path.includes('-chrome.zip!/') ||
      finding.path.includes('-firefox.zip!/')
    return !(
      browserBundle &&
      (finding.code === 'private-network-reference' ||
        finding.code === 'unapproved-public-url')
    )
  })
  if (blockingFindings.length > 0) {
    throw new Error(
      `Public guard rejected release archives:\n${blockingFindings.map(item => `${item.path}:${item.line} ${item.code}`).join('\n')}`
    )
  }
  return { files, manifest }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2))
  if (typeof args.directory !== 'string')
    throw new Error('Usage: guard-artifact.mjs --directory <path>')
  const directory = resolve(args.directory)
  await guardReleaseDirectory({ root: process.cwd(), directory })
  console.log(`Release artifact guard passed for ${basename(directory)}.`)
}
