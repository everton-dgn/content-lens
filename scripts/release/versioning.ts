import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ReleaseBump = 'major' | 'minor' | 'patch'

export type StableReleasePlan =
  | {
      readonly status: 'skipped'
      readonly ignoredCommits: readonly string[]
    }
  | {
      readonly status: 'prepared'
      readonly bump: ReleaseBump
      readonly changelog: string
      readonly ignoredCommits: readonly string[]
      readonly manifest: Record<string, unknown> & { version: string }
      readonly tag: string
      readonly version: string
    }

type ParsedCommit = {
  readonly bump: ReleaseBump | null
  readonly releaseSection: 'Added' | 'Changed' | 'Fixed' | null
  readonly summary: string
}

const stableVersionPattern =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/u
const conventionalCommitPattern =
  /^(?<type>[a-z][a-z0-9-]*)(?:\((?<scope>[^)\r\n]+)\))?(?<breaking>!)?: (?<summary>.+)$/u
const breakingChangeFooterPattern =
  /^BREAKING(?: CHANGE|-CHANGE):[^\S\r\n]+\S.*$/u
const footerTokenPattern =
  /^(?:BREAKING CHANGE|[A-Za-z][A-Za-z0-9-]*)(?::[^\S\r\n]+|[^\S\r\n]+#)\S.*$/u
const fencedCodeMarkerPattern = /^(?<marker>`{3,}|~{3,})/u
const dependencyScopes = new Set(['deps', 'deps-dev'])
const bumpRank: Readonly<Record<ReleaseBump, number>> = {
  major: 3,
  minor: 2,
  patch: 1
}

const parseVersionParts = (value: string) => {
  const match = String(value).trim().match(stableVersionPattern)
  if (!match?.groups) {
    throw new Error(
      `Unsupported stable version "${value}". Expected SemVer like 1.2.3.`
    )
  }
  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    version: String(value).trim()
  }
}

export const parseStableVersion = (value: string) =>
  parseVersionParts(value).version

export const normalizeStableTag = (tag: string) => {
  const value = String(tag).trim()
  if (!value.startsWith('v')) {
    throw new Error(`Unsupported stable tag "${tag}".`)
  }
  return `v${parseStableVersion(value.slice(1))}`
}

export const computeNextStableVersion = (
  currentVersion: string,
  bump: ReleaseBump
) => {
  const current = parseVersionParts(currentVersion)
  if (bump === 'major') return `${current.major + 1}.0.0`
  if (bump === 'minor') return `${current.major}.${current.minor + 1}.0`
  return `${current.major}.${current.minor}.${current.patch + 1}`
}

const strongerBump = (
  current: ReleaseBump | null,
  candidate: ReleaseBump | null
) => {
  if (!candidate) return current
  if (!current || bumpRank[candidate] > bumpRank[current]) return candidate
  return current
}

const hasBreakingChangeFooter = (bodyLines: readonly string[]) => {
  if (bodyLines[0]?.trim() !== '') return false

  let footerStarted = false
  let fenceCharacter: string | null = null
  for (const [index, line] of bodyLines.entries()) {
    const marker = line.trimStart().match(fencedCodeMarkerPattern)
      ?.groups?.marker
    if (marker) {
      const markerCharacter = marker[0] ?? null
      if (!fenceCharacter) fenceCharacter = markerCharacter
      else if (fenceCharacter === markerCharacter) fenceCharacter = null
      continue
    }
    if (fenceCharacter) continue
    if (
      !footerStarted &&
      index > 0 &&
      bodyLines[index - 1]?.trim() === '' &&
      footerTokenPattern.test(line)
    ) {
      footerStarted = true
    }
    if (footerStarted && breakingChangeFooterPattern.test(line)) {
      return true
    }
  }
  return false
}

const parseCommit = (message: string): ParsedCommit | null => {
  const normalized = String(message).trim()
  const [subject = '', ...bodyLines] = normalized.split(/\r?\n/u)
  const breakingFooter = hasBreakingChangeFooter(bodyLines)
  const match = subject.match(conventionalCommitPattern)
  if (!match?.groups) {
    if (!subject || !breakingFooter) return null
    return {
      bump: 'major',
      releaseSection: 'Changed',
      summary: subject
    }
  }

  const type = match.groups.type
  const summary = match.groups.summary
  if (!type || !summary) return null
  const scope = match.groups.scope ?? ''
  const breaking = match.groups.breaking === '!' || breakingFooter
  if (breaking) {
    return {
      bump: 'major',
      releaseSection: 'Changed',
      summary
    }
  }
  if (type === 'feat') {
    return {
      bump: 'minor',
      releaseSection: 'Added',
      summary
    }
  }
  if (['fix', 'perf', 'revert'].includes(type)) {
    return {
      bump: 'patch',
      releaseSection: 'Fixed',
      summary
    }
  }
  if (['build', 'chore'].includes(type) && dependencyScopes.has(scope)) {
    return {
      bump: 'patch',
      releaseSection: 'Fixed',
      summary
    }
  }
  return {
    bump: null,
    releaseSection: null,
    summary
  }
}

export const collectIgnoredCommits = (messages: readonly string[]) =>
  messages
    .filter(message => !parseCommit(message))
    .map(message => String(message).trim().split(/\r?\n/u)[0] ?? '')
    .filter(Boolean)

export const deriveReleaseBump = (
  messages: readonly string[]
): ReleaseBump | null => {
  let bump: ReleaseBump | null = null
  for (const message of messages) {
    bump = strongerBump(bump, parseCommit(message)?.bump ?? null)
  }
  return bump
}

export const deriveNextStableVersion = ({
  baselineTag,
  currentVersion,
  messages
}: {
  readonly baselineTag: string
  readonly currentVersion: string
  readonly messages: readonly string[]
}) => {
  const current = parseStableVersion(currentVersion)
  if (baselineTag) {
    const taggedVersion = normalizeStableTag(baselineTag).slice(1)
    if (current !== taggedVersion) {
      throw new Error(
        `package.json version ${current} does not match latest tag ${baselineTag}.`
      )
    }
  } else if (current !== '0.0.0') {
    throw new Error('The first stable release must start from version 0.0.0.')
  }

  const derivedBump = deriveReleaseBump(messages)
  if (!derivedBump) return null
  if (!baselineTag) {
    return { bump: 'major' as const, version: '1.0.0' }
  }
  return {
    bump: derivedBump,
    version: computeNextStableVersion(current, derivedBump)
  }
}

const sanitizeReleaseSummary = (value: string) => {
  const sanitized = String(value)
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/@(?=[\p{L}\p{N}_-])/gu, '&#64;')
    .replace(/(?<!&)#(?=\d)/gu, '&#35;')
    .trim()
  return sanitized
    .replace(/^(#{1,6})(?=\s|$)/u, '\\$1')
    .replace(/^([-+*])(?=\s)/u, '\\$1')
    .replace(/^(\d{1,9})([.)])(?=\s)/u, '$1\\$2')
    .replace(/^(`{3,}|~{3,})/u, '\\$1')
    .replace(/^([-*_])(?=(?:\s*\1){2,}\s*$)/u, '\\$1')
}

const buildGeneratedReleaseNotes = (messages: readonly string[]) => {
  const sections = new Map<string, string[]>([
    ['Added', []],
    ['Changed', []],
    ['Fixed', []]
  ])
  for (const message of messages) {
    const parsed = parseCommit(message)
    if (!parsed?.bump || !parsed.releaseSection) continue
    sections
      .get(parsed.releaseSection)
      ?.push(`- ${sanitizeReleaseSummary(parsed.summary)}`)
  }
  return [...sections]
    .filter(([, entries]) => entries.length > 0)
    .map(([section, entries]) => `### ${section}\n\n${entries.join('\n')}`)
    .join('\n\n')
}

const releaseHeadingPattern =
  /^## (?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)) - (?<date>\d{4}-\d{2}-\d{2})\s*$/gmu

type ReleaseHeading = {
  readonly end: number
  readonly index: number
  readonly version: string
}

const findReleaseHeadings = (changelog: string): ReleaseHeading[] => {
  const headings: ReleaseHeading[] = []
  for (const match of changelog.matchAll(releaseHeadingPattern)) {
    if (match.index === undefined || !match.groups) continue
    const versionPrefix = match[0].match(/^## (?<version>\d+\.\d+\.\d+)/u)
    const version = versionPrefix?.groups?.version
    if (!version) continue
    headings.push({
      end: match.index + match[0].length,
      index: match.index,
      version: parseStableVersion(version)
    })
  }
  return headings
}

const prepareChangelog = ({
  changelog,
  date,
  messages,
  version
}: {
  readonly changelog: string
  readonly date: string
  readonly messages: readonly string[]
  readonly version: string
}) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new Error(`Invalid stable release date: ${date}`)
  }
  const normalizedVersion = parseStableVersion(version)
  const headings = findReleaseHeadings(changelog)
  if (headings.some(heading => heading.version === normalizedVersion)) {
    throw new Error(`CHANGELOG.md already contains ${normalizedVersion}.`)
  }
  const marker = /^## Unreleased\s*$/mu.exec(changelog)
  if (!marker || marker.index === undefined) {
    throw new Error('CHANGELOG.md must contain a top-level Unreleased section.')
  }
  const bodyStart = marker.index + marker[0].length
  const nextHeading = headings.find(heading => heading.index > bodyStart)
  const bodyEnd = nextHeading?.index ?? changelog.length
  const curatedNotes = changelog.slice(bodyStart, bodyEnd).trim()
  const notes = curatedNotes || buildGeneratedReleaseNotes(messages)
  if (!notes) {
    throw new Error(`Cannot build release notes for ${normalizedVersion}.`)
  }

  const prefix = changelog.slice(0, bodyStart).trimEnd()
  const suffix = changelog.slice(bodyEnd).trim()
  return [prefix, `## ${normalizedVersion} - ${date}\n\n${notes}`, suffix]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n')
}

export const createStableReleasePlan = ({
  baselineTag,
  changelog,
  currentManifest,
  date,
  messages
}: {
  readonly baselineTag: string
  readonly changelog: string
  readonly currentManifest: Record<string, unknown>
  readonly date: string
  readonly messages: readonly string[]
}): StableReleasePlan => {
  const currentVersion = parseStableVersion(
    String(currentManifest.version ?? '')
  )
  const derived = deriveNextStableVersion({
    baselineTag,
    currentVersion,
    messages
  })
  const ignoredCommits = collectIgnoredCommits(messages)
  if (!derived) return { ignoredCommits, status: 'skipped' }

  return {
    bump: derived.bump,
    changelog: prepareChangelog({
      changelog,
      date,
      messages,
      version: derived.version
    }),
    ignoredCommits,
    manifest: { ...currentManifest, version: derived.version },
    status: 'prepared',
    tag: `v${derived.version}`,
    version: derived.version
  }
}

export const extractReleaseNotes = (changelog: string, version: string) => {
  const normalizedVersion = parseStableVersion(version)
  const headings = findReleaseHeadings(changelog)
  const index = headings.findIndex(
    heading => heading.version === normalizedVersion
  )
  if (index < 0) {
    throw new Error(
      `CHANGELOG.md does not contain release ${normalizedVersion}.`
    )
  }
  const heading = headings[index]
  if (!heading) {
    throw new Error(
      `CHANGELOG.md does not contain release ${normalizedVersion}.`
    )
  }
  const nextHeading = headings[index + 1]
  const notes = changelog
    .slice(heading.end, nextHeading?.index ?? changelog.length)
    .trim()
  if (!notes) {
    throw new Error(`CHANGELOG.md release ${normalizedVersion} has no notes.`)
  }
  return notes
}

export const assertStableReleaseTransition = ({
  changelog,
  currentVersion,
  previousVersion
}: {
  readonly changelog: string
  readonly currentVersion: string
  readonly previousVersion: string
}) => {
  const current = parseStableVersion(currentVersion)
  const previous = parseStableVersion(previousVersion)
  const supported =
    (previous === '0.0.0' && current === '1.0.0') ||
    (['major', 'minor', 'patch'] as const).some(
      bump => computeNextStableVersion(previous, bump) === current
    )
  if (!supported) {
    throw new Error(
      `Stable release version ${previous} -> ${current} is unsupported.`
    )
  }
  extractReleaseNotes(changelog, current)
  return current
}

const runNotesCommand = (argv: readonly string[]) => {
  if (
    argv.length !== 4 ||
    argv[0] !== '--version' ||
    argv[2] !== '--notes-output'
  ) {
    throw new Error(
      'Usage: versioning.ts --version <X.Y.Z> --notes-output <path>'
    )
  }
  const versionValue = argv[1]
  const outputValue = argv[3]
  if (!versionValue || !outputValue) {
    throw new Error(
      'Usage: versioning.ts --version <X.Y.Z> --notes-output <path>'
    )
  }
  const version = parseStableVersion(versionValue)
  const output = resolve(outputValue)
  const changelog = readFileSync(resolve('CHANGELOG.md'), 'utf8')
  writeFileSync(output, `${extractReleaseNotes(changelog, version)}\n`, {
    flag: 'wx'
  })
}

const isMainModule = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isMainModule) {
  try {
    runNotesCommand(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
