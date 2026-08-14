import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertStableReleaseTransition,
  createStableReleasePlan,
  normalizeStableTag,
  parseStableVersion
} from './versioning.ts'

type ReleaseContext = {
  readonly conclusion: string
  readonly event: string
  readonly githubOutput: string
  readonly headBranch: string
  readonly owner: string
  readonly repo: string
  readonly repository: string
  readonly runId: string
  readonly sourceRepository: string
  readonly sourceSha: string
}

type PullRequest = {
  readonly base?: {
    readonly ref?: string
    readonly repo?: {
      // biome-ignore lint/style/useNamingConvention: GitHub API field name.
      readonly full_name?: string
    }
  }
  readonly head?: {
    readonly ref?: string
    readonly repo?: {
      // biome-ignore lint/style/useNamingConvention: GitHub API field name.
      readonly full_name?: string
    }
    readonly sha?: string
  }
  // biome-ignore lint/style/useNamingConvention: GitHub API field name.
  readonly merge_commit_sha?: string | null
  // biome-ignore lint/style/useNamingConvention: GitHub API field name.
  readonly merged_at?: string | null
  readonly mergeable?: boolean | null
  // biome-ignore lint/style/useNamingConvention: GitHub API field name.
  readonly mergeable_state?: string
  readonly number?: number
  readonly state?: string
  readonly title?: string
  readonly user?: { readonly login?: string }
}

type ReleaseMerge = {
  readonly baseSha: string
  readonly mergeSha: string
  readonly releaseSha: string
  readonly sourceSha: string
  readonly tag: string
  readonly version: string
}

type AutomaticReleaseResult = {
  readonly commit?: string
  readonly continueRelease?: boolean
  readonly publish: boolean
  readonly status:
    | 'already-released'
    | 'released'
    | 'recovered'
    | 'skipped'
    | 'stale'
  readonly tag?: string
  readonly version?: string
}

type WorkflowRun = {
  readonly actor?: { readonly login?: string }
  readonly conclusion?: string | null
  readonly event?: string
  // biome-ignore lint/style/useNamingConvention: GitHub API field name.
  readonly head_branch?: string | null
  // biome-ignore lint/style/useNamingConvention: GitHub API field name.
  readonly head_sha?: string
  readonly id?: number
  readonly name?: string
  readonly repository?: {
    // biome-ignore lint/style/useNamingConvention: GitHub API field name.
    readonly full_name?: string
  }
  readonly status?: string
}

type GitHubRelease = {
  readonly assets?: ReadonlyArray<{ readonly name?: string }>
  readonly draft?: boolean
  readonly id?: number
  readonly prerelease?: boolean
  // biome-ignore lint/style/useNamingConvention: GitHub API field name.
  readonly tag_name?: string
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const shaPattern = /^[0-9a-f]{40,64}$/u
const repositoryPattern =
  /^(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)$/u
const releaseBranchPattern = /^release\/v\d+\.\d+\.\d+-[0-9a-f]{12}$/u
const releaseSubjectPattern = /^chore\(release\): cut (?<tag>v\d+\.\d+\.\d+)$/u
const stableTagPattern = /^v\d+\.\d+\.\d+$/u
const botLogins = new Set(['github-actions', 'github-actions[bot]'])
const releaseFiles = ['CHANGELOG.md', 'package.json'] as const
export const stableReleaseAssetNames = (version: string) => {
  const stableVersion = parseStableVersion(version)
  return [
    'checksums.sha256',
    `content-lens-${stableVersion}-chrome.zip`,
    `content-lens-${stableVersion}-firefox.zip`,
    `content-lens-${stableVersion}-sources.zip`,
    'provenance.intoto.json',
    'release-manifest.json',
    'sbom.spdx.json'
  ]
}

export const stableReleaseAssetSetIsExact = (
  version: string,
  names: readonly string[]
) => {
  const expected = stableReleaseAssetNames(version)
  const actual = new Set(names)
  return (
    names.length === expected.length && expected.every(name => actual.has(name))
  )
}

type StableReleaseSnapshot = {
  readonly assets: readonly string[]
  readonly draft: boolean
  readonly id: number
  readonly prerelease: boolean
  readonly tag: string
}

const stableReleaseSnapshotIsComplete = (
  tag: string,
  release: StableReleaseSnapshot | undefined
) => {
  const normalizedTag = normalizeStableTag(tag)
  return Boolean(
    release &&
      release.tag === normalizedTag &&
      Number.isSafeInteger(release.id) &&
      release.id > 0 &&
      !release.draft &&
      !release.prerelease &&
      stableReleaseAssetSetIsExact(normalizedTag.slice(1), release.assets)
  )
}

export const selectOldestIncompleteStableTag = ({
  releases,
  tags
}: {
  readonly releases: readonly StableReleaseSnapshot[]
  readonly tags: readonly string[]
}) => {
  const releasesByTag = new Map<string, StableReleaseSnapshot>()
  for (const release of releases) {
    if (!stableTagPattern.test(release.tag) || release.draft) continue
    if (releasesByTag.has(release.tag)) {
      throw new Error(`Multiple GitHub Releases use tag ${release.tag}.`)
    }
    releasesByTag.set(release.tag, release)
  }
  for (const tag of [...tags].reverse()) {
    const normalizedTag = normalizeStableTag(tag)
    if (
      !stableReleaseSnapshotIsComplete(
        normalizedTag,
        releasesByTag.get(normalizedTag)
      )
    ) {
      return normalizedTag
    }
  }
  return null
}

const execute = (
  command: string,
  args: readonly string[],
  {
    capture = true,
    env = {}
  }: {
    readonly capture?: boolean
    readonly env?: Readonly<Record<string, string>>
  } = {}
) => {
  const result = spawnSync(command, [...args], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 30 * 1024 * 1024,
    stdio: capture ? 'pipe' : 'inherit'
  })
  if (result.status !== 0) {
    const detail = capture
      ? String(result.stderr || result.stdout || '').trim()
      : ''
    throw new Error(
      `${command} ${args.join(' ')} failed with status ${result.status}.${detail ? `\n${detail}` : ''}`
    )
  }
  return capture ? String(result.stdout).trim() : ''
}

const commandSucceeds = (command: string, args: readonly string[]) => {
  const result = spawnSync(command, [...args], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'ignore'
  })
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error(
    `${command} ${args.join(' ')} failed with status ${result.status}.`
  )
}

const readGit = (args: readonly string[]) => execute('git', args)
const writeGit = (
  args: readonly string[],
  options: { readonly env?: Readonly<Record<string, string>> } = {}
) => execute('git', args, { capture: false, ...options })
const fetchRemoteMain = ({ tags = false }: { readonly tags?: boolean } = {}) =>
  writeGit([
    'fetch',
    '--no-recurse-submodules',
    'origin',
    '+refs/heads/main:refs/remotes/origin/main',
    ...(tags ? ['--tags'] : [])
  ])
const readGhJson = <Value>(args: readonly string[]) =>
  JSON.parse(execute('gh', args)) as Value
const writeGhJson = <Value>(args: readonly string[]) =>
  JSON.parse(execute('gh', args)) as Value
const tryReadGhJson = <Value>(args: readonly string[]) => {
  try {
    return readGhJson<Value>(args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/HTTP 404|Not Found/iu.test(message)) return null
    throw error
  }
}

const requireSha = (value: unknown, label: string) => {
  const sha = String(value ?? '')
  if (!shaPattern.test(sha)) {
    throw new Error(`Invalid ${label}: ${sha || 'missing'}.`)
  }
  return sha
}

const isGitAncestor = (ancestor: string, descendant: string) =>
  commandSucceeds('git', [
    'merge-base',
    '--is-ancestor',
    requireSha(ancestor, 'ancestor SHA'),
    requireSha(descendant, 'descendant SHA')
  ])

export const releaseBaseCoversSource = ({
  baseSha,
  isAncestor = isGitAncestor,
  sourceSha
}: {
  readonly baseSha: string
  readonly isAncestor?: (ancestor: string, descendant: string) => boolean
  readonly sourceSha: string
}) =>
  isAncestor(
    requireSha(sourceSha, 'release source SHA'),
    requireSha(baseSha, 'release base SHA')
  )

export const createReleaseMessageRanges = ({
  baselineTag,
  sourceSha
}: {
  readonly baselineTag: string
  readonly sourceSha: string
}) => {
  const source = requireSha(sourceSha, 'release source SHA')
  if (!baselineTag) return [source]
  return [`${normalizeStableTag(baselineTag)}..${source}`]
}

export const parseAutomaticReleaseContext = (
  env: NodeJS.ProcessEnv = process.env
): ReleaseContext => {
  const repository = String(env.GITHUB_REPOSITORY ?? '')
  const match = repository.match(repositoryPattern)
  const owner = match?.groups?.owner
  const repo = match?.groups?.repo
  const context = {
    conclusion: String(env.RELEASE_SOURCE_CONCLUSION ?? ''),
    event: String(env.RELEASE_SOURCE_EVENT ?? ''),
    githubOutput: String(env.GITHUB_OUTPUT ?? ''),
    headBranch: String(env.RELEASE_SOURCE_BRANCH ?? ''),
    repository,
    runId: String(env.RELEASE_SOURCE_RUN_ID ?? ''),
    sourceRepository: String(env.RELEASE_SOURCE_REPOSITORY ?? ''),
    sourceSha: String(env.RELEASE_SOURCE_SHA ?? '')
  }
  if (String(env.GITHUB_ACTIONS ?? '') !== 'true') {
    throw new Error('Automatic releases run only inside GitHub Actions.')
  }
  if (!owner || !repo || context.sourceRepository !== repository) {
    throw new Error('Release source must be the current GitHub repository.')
  }
  if (
    context.conclusion !== 'success' ||
    !['push', 'workflow_dispatch'].includes(context.event) ||
    context.headBranch !== 'main'
  ) {
    throw new Error(
      'Automatic releases require an accepted successful CI run on main.'
    )
  }
  requireSha(context.sourceSha, 'release source SHA')
  if (!/^[1-9]\d*$/u.test(context.runId)) {
    throw new Error('Automatic release source run ID is invalid.')
  }
  return {
    ...context,
    owner,
    repo
  }
}

export const createReleaseBranchName = (version: string, sourceSha: string) => {
  const branch = `release/v${parseStableVersion(version)}-${requireSha(sourceSha, 'release source SHA').slice(0, 12)}`
  if (!releaseBranchPattern.test(branch)) {
    throw new Error(`Invalid automatic release branch: ${branch}.`)
  }
  return branch
}

export const createMergePullRequestArguments = ({
  branch,
  number,
  releaseSha,
  repository,
  tag
}: {
  readonly branch: string
  readonly number: number
  readonly releaseSha: string
  readonly repository: string
  readonly tag: string
}) => {
  if (!releaseBranchPattern.test(branch)) {
    throw new Error(`Invalid automatic release branch: ${branch}.`)
  }
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`Invalid release pull request number: ${number}.`)
  }
  return [
    'api',
    '--method',
    'PUT',
    `repos/${repository}/pulls/${number}/merge`,
    '-f',
    `sha=${requireSha(releaseSha, 'release commit SHA')}`,
    '-f',
    'merge_method=merge',
    '-f',
    `commit_title=Merge pull request #${number} from ${branch}`,
    '-f',
    `commit_message=Merge automatic stable release ${normalizeStableTag(tag)}\n\n[skip ci]`
  ]
}

export const createReleaseByTagArguments = ({
  repository,
  tag
}: {
  readonly repository: string
  readonly tag: string
}) => {
  if (!repositoryPattern.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}.`)
  }
  return [
    'api',
    '--method',
    'GET',
    `repos/${repository}/releases/tags/${normalizeStableTag(tag)}`
  ]
}

export const assertReleaseChangedFiles = (files: readonly string[]) => {
  const actual = [...new Set(files)].sort()
  const expected = [...releaseFiles].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Release commit may change only ${expected.join(' and ')}; found ${actual.join(', ') || 'none'}.`
    )
  }
}

const splitLines = (value: string) =>
  String(value)
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)

const readParents = (commit: string) =>
  readGit([
    'rev-list',
    '--parents',
    '-n',
    '1',
    requireSha(commit, 'commit SHA')
  ])
    .trim()
    .split(/\s+/u)

export const inspectReleaseMerge = ({
  mergeSha,
  releaseSha,
  tag
}: {
  readonly mergeSha: string
  readonly releaseSha: string
  readonly tag: string
}): ReleaseMerge => {
  const normalizedMergeSha = requireSha(mergeSha, 'release merge SHA')
  const normalizedReleaseSha = requireSha(releaseSha, 'release commit SHA')
  const normalizedTag = normalizeStableTag(tag)
  const parents = readParents(normalizedMergeSha)
  if (
    parents.length !== 3 ||
    parents[0] !== normalizedMergeSha ||
    parents[2] !== normalizedReleaseSha
  ) {
    throw new Error(
      `Release merge ${normalizedMergeSha} must have the release commit as its second parent.`
    )
  }
  const baseSha = requireSha(parents[1], 'release merge base SHA')
  const releaseParents = readParents(normalizedReleaseSha)
  if (
    releaseParents.length !== 2 ||
    releaseParents[0] !== normalizedReleaseSha
  ) {
    throw new Error(
      `Release commit ${normalizedReleaseSha} must have exactly one parent.`
    )
  }
  const sourceSha = requireSha(releaseParents[1], 'release source SHA')
  if (!isGitAncestor(sourceSha, baseSha)) {
    throw new Error(
      `Release source ${sourceSha} must be an ancestor of merge base ${baseSha}.`
    )
  }
  const subject = readGit(['log', '-1', '--format=%s', normalizedReleaseSha])
  if (subject !== `chore(release): cut ${normalizedTag}`) {
    throw new Error(`Unexpected release commit subject: ${subject}.`)
  }
  assertReleaseChangedFiles(
    splitLines(readGit(['diff', '--name-only', baseSha, normalizedMergeSha]))
  )
  assertReleaseChangedFiles(
    splitLines(
      readGit(['diff', '--name-only', sourceSha, normalizedReleaseSha])
    )
  )
  const currentManifest = JSON.parse(
    readGit(['show', `${normalizedMergeSha}:package.json`])
  ) as { version?: unknown }
  const previousManifest = JSON.parse(
    readGit(['show', `${baseSha}:package.json`])
  ) as { version?: unknown }
  const sourceManifest = JSON.parse(
    readGit(['show', `${sourceSha}:package.json`])
  ) as { version?: unknown }
  const changelog = readGit(['show', `${normalizedMergeSha}:CHANGELOG.md`])
  const mergedVersion = assertStableReleaseTransition({
    changelog,
    currentVersion: String(currentManifest.version ?? ''),
    previousVersion: String(previousManifest.version ?? '')
  })
  const releaseVersion = assertStableReleaseTransition({
    changelog,
    currentVersion: String(currentManifest.version ?? ''),
    previousVersion: String(sourceManifest.version ?? '')
  })
  if (
    mergedVersion !== releaseVersion ||
    normalizedTag !== `v${releaseVersion}`
  ) {
    throw new Error(
      `Release tag ${normalizedTag} does not match package version ${releaseVersion}.`
    )
  }
  return {
    baseSha,
    mergeSha: normalizedMergeSha,
    releaseSha: normalizedReleaseSha,
    sourceSha,
    tag: normalizedTag,
    version: releaseVersion
  }
}

const assertAutomationPullRequest = ({
  branch,
  mergeSha,
  pullRequest,
  releaseSha,
  repository
}: {
  readonly branch: string
  readonly mergeSha?: string
  readonly pullRequest: PullRequest
  readonly releaseSha: string
  readonly repository: string
}) => {
  if (
    !Number.isSafeInteger(pullRequest.number) ||
    Number(pullRequest.number) < 1
  ) {
    throw new Error('Automatic release PR has an invalid number.')
  }
  if (!botLogins.has(String(pullRequest.user?.login ?? ''))) {
    throw new Error('Automatic release PR has an unexpected author.')
  }
  if (
    pullRequest.base?.ref !== 'main' ||
    pullRequest.base?.repo?.full_name !== repository
  ) {
    throw new Error('Automatic release PR has an unexpected base.')
  }
  if (
    pullRequest.head?.ref !== branch ||
    pullRequest.head?.repo?.full_name !== repository ||
    pullRequest.head?.sha !== releaseSha
  ) {
    throw new Error('Automatic release PR has an unexpected head.')
  }
  if (
    mergeSha &&
    (pullRequest.state !== 'closed' ||
      !pullRequest.merged_at ||
      pullRequest.merge_commit_sha !== mergeSha)
  ) {
    throw new Error('Automatic release PR does not match its merge commit.')
  }
  return pullRequest
}

const assertAssociatedReleasePullRequest = (
  context: ReleaseContext,
  release: ReleaseMerge
) => {
  const branch = createReleaseBranchName(release.version, release.sourceSha)
  const matching = listReleasePullRequests(context, branch).filter(
    pullRequest =>
      pullRequest.head?.sha === release.releaseSha &&
      pullRequest.merge_commit_sha === release.mergeSha
  )
  if (matching.length !== 1 || !matching[0]) {
    throw new Error(
      `Release merge ${release.mergeSha} must have one associated pull request.`
    )
  }
  return assertAutomationPullRequest({
    branch,
    mergeSha: release.mergeSha,
    pullRequest: matching[0],
    releaseSha: release.releaseSha,
    repository: context.repository
  })
}

const verifySourceWorkflowRun = (context: ReleaseContext) => {
  const run = readGhJson<WorkflowRun>([
    'api',
    `repos/${context.repository}/actions/runs/${context.runId}`
  ])
  if (
    String(run.id ?? '') !== context.runId ||
    run.name !== 'CI' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.event !== context.event ||
    run.head_branch !== 'main' ||
    run.head_sha !== context.sourceSha ||
    run.repository?.full_name !== context.repository
  ) {
    throw new Error('Release source workflow run does not match verified CI.')
  }
  if (
    run.event === 'workflow_dispatch' &&
    !botLogins.has(String(run.actor?.login ?? ''))
  ) {
    throw new Error('Only the release bot may dispatch continuation CI.')
  }
  return run
}

const sleep = (milliseconds: number) =>
  new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))

const listStableTags = (ref: string) =>
  splitLines(
    readGit(['tag', '--merged', ref, '--list', 'v*', '--sort=-version:refname'])
  ).filter(tag => stableTagPattern.test(tag))

const latestStableTag = (ref: string) => listStableTags(ref)[0] ?? ''

const getRemoteTagState = (tag: string) => {
  const normalizedTag = normalizeStableTag(tag)
  const objectOutput = readGit([
    'ls-remote',
    '--refs',
    'origin',
    `refs/tags/${normalizedTag}`
  ])
  if (!objectOutput) return { commit: '', objectId: '' }
  const objectId = requireSha(
    objectOutput.split(/\s+/u)[0],
    'remote tag object SHA'
  )
  const peeledOutput = readGit([
    'ls-remote',
    'origin',
    `refs/tags/${normalizedTag}^{}`
  ])
  return {
    commit: peeledOutput
      ? requireSha(peeledOutput.split(/\s+/u)[0], 'remote tag commit SHA')
      : objectId,
    objectId
  }
}

const assertRemoteTag = ({
  localObjectId,
  remoteCommit,
  remoteObjectId,
  tag,
  targetSha
}: {
  readonly localObjectId: string
  readonly remoteCommit: string
  readonly remoteObjectId: string
  readonly tag: string
  readonly targetSha: string
}) => {
  if (
    requireSha(remoteCommit, 'remote tag commit SHA') !== targetSha ||
    requireSha(remoteObjectId, 'remote tag object SHA') !== localObjectId
  ) {
    throw new Error(`Remote tag ${tag} does not match the validated release.`)
  }
}

const createAndPushTag = (release: ReleaseMerge) => {
  const tagRef = `refs/tags/${release.tag}`
  let target: string
  if (commandSucceeds('git', ['show-ref', '--verify', '--quiet', tagRef])) {
    target = readGit(['rev-list', '-n', '1', release.tag])
  } else {
    const timestamp = readGit(['show', '-s', '--format=%cI', release.sourceSha])
    writeGit(
      [
        '-c',
        'user.name=github-actions[bot]',
        '-c',
        'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        '-c',
        'tag.gpgSign=false',
        'tag',
        '-a',
        release.tag,
        '-m',
        release.tag,
        release.releaseSha
      ],
      { env: { GIT_COMMITTER_DATE: timestamp } }
    )
    target = readGit(['rev-list', '-n', '1', release.tag])
  }
  if (target !== release.releaseSha) {
    throw new Error(
      `Local tag ${release.tag} points to ${target}, expected ${release.releaseSha}.`
    )
  }
  if (readGit(['cat-file', '-t', `refs/tags/${release.tag}`]) !== 'tag') {
    throw new Error(`Stable release tag ${release.tag} must be annotated.`)
  }
  const localObjectId = requireSha(
    readGit(['rev-parse', '--verify', `refs/tags/${release.tag}`]),
    'local tag object SHA'
  )
  let remote = getRemoteTagState(release.tag)
  if (!remote.commit) {
    writeGit(['push', 'origin', `refs/tags/${release.tag}`])
    remote = getRemoteTagState(release.tag)
  }
  assertRemoteTag({
    localObjectId,
    remoteCommit: remote.commit,
    remoteObjectId: remote.objectId,
    tag: release.tag,
    targetSha: release.releaseSha
  })
}

const verifyPublishedTag = (
  context: ReleaseContext,
  tag: string
): ReleaseMerge => {
  const normalizedTag = normalizeStableTag(tag)
  if (readGit(['cat-file', '-t', `refs/tags/${normalizedTag}`]) !== 'tag') {
    throw new Error(`Stable release tag ${normalizedTag} must be annotated.`)
  }
  const releaseSha = requireSha(
    readGit(['rev-list', '-n', '1', normalizedTag]),
    'stable tag commit SHA'
  )
  const parents = readParents(releaseSha)
  if (parents.length !== 2 || !parents[1]) {
    throw new Error(
      `Stable tag ${normalizedTag} must point to a release commit.`
    )
  }
  const sourceSha = requireSha(parents[1], 'release source SHA')
  const version = parseStableVersion(normalizedTag.slice(1))
  const branch = createReleaseBranchName(version, sourceSha)
  const matching = listReleasePullRequests(context, branch).filter(
    pullRequest =>
      pullRequest.head?.sha === releaseSha &&
      pullRequest.merged_at &&
      pullRequest.merge_commit_sha
  )
  if (matching.length !== 1 || !matching[0]) {
    throw new Error(
      `Release commit ${releaseSha} must have one merged pull request.`
    )
  }
  const mergeSha = requireSha(matching[0].merge_commit_sha, 'release merge SHA')
  const release = inspectReleaseMerge({
    mergeSha,
    releaseSha,
    tag: normalizedTag
  })
  if (!isGitAncestor(mergeSha, readGit(['rev-parse', 'origin/main']))) {
    throw new Error(`Stable tag ${normalizedTag} is not reachable from main.`)
  }
  assertAutomationPullRequest({
    branch,
    mergeSha,
    pullRequest: matching[0],
    releaseSha,
    repository: context.repository
  })
  const localObjectId = requireSha(
    readGit(['rev-parse', '--verify', `refs/tags/${normalizedTag}`]),
    'local tag object SHA'
  )
  const remote = getRemoteTagState(normalizedTag)
  assertRemoteTag({
    localObjectId,
    remoteCommit: remote.commit,
    remoteObjectId: remote.objectId,
    tag: normalizedTag,
    targetSha: releaseSha
  })
  return release
}

const findReleaseCoveringSource = (
  context: ReleaseContext,
  stableTags: readonly string[]
): ReleaseMerge | null => {
  const latestTag = stableTags[0]
  if (!latestTag) return null
  const release = verifyPublishedTag(context, latestTag)
  return releaseBaseCoversSource({
    baseSha: release.baseSha,
    sourceSha: context.sourceSha
  })
    ? release
    : null
}

const findPendingReleaseMerge = (): ReleaseMerge | null => {
  const baselineTag = latestStableTag('origin/main')
  const revision = baselineTag ? `${baselineTag}..origin/main` : 'origin/main'
  const pending: ReleaseMerge[] = []
  for (const mergeSha of splitLines(
    readGit(['rev-list', '--first-parent', '--merges', revision])
  )) {
    const parents = readParents(mergeSha)
    if (parents.length !== 3 || !parents[2]) continue
    const releaseSha = parents[2]
    const subject = readGit(['log', '-1', '--format=%s', releaseSha])
    const match = subject.match(releaseSubjectPattern)
    const matchedTag = match?.groups?.tag
    if (!matchedTag) continue
    const tag = normalizeStableTag(matchedTag)
    const remote = getRemoteTagState(tag)
    if (remote.commit) {
      if (remote.commit !== releaseSha) {
        throw new Error(
          `Stable tag ${tag} points to ${remote.commit}, expected ${releaseSha}.`
        )
      }
      continue
    }
    pending.push(inspectReleaseMerge({ mergeSha, releaseSha, tag }))
  }
  return selectOldestPendingRelease(pending)
}

export const selectOldestPendingRelease = <Value>(pending: readonly Value[]) =>
  pending.at(-1) ?? null

const toStableReleaseSnapshot = (
  release: GitHubRelease,
  assets: readonly string[] = release.assets?.map(asset =>
    String(asset.name ?? '')
  ) ?? []
): StableReleaseSnapshot => ({
  assets,
  draft: Boolean(release.draft),
  id: Number(release.id ?? 0),
  prerelease: Boolean(release.prerelease),
  tag: String(release.tag_name ?? '')
})

const listStableReleaseSnapshots = (context: ReleaseContext) =>
  readGhJson<ReadonlyArray<ReadonlyArray<GitHubRelease>>>([
    'api',
    '--paginate',
    '--slurp',
    '--method',
    'GET',
    `repos/${context.repository}/releases`,
    '-f',
    'per_page=100'
  ])
    .flat()
    .map(release => toStableReleaseSnapshot(release))

const readStableReleaseSnapshot = (context: ReleaseContext, tag: string) => {
  const published = tryReadGhJson<GitHubRelease>(
    createReleaseByTagArguments({
      repository: context.repository,
      tag
    })
  )
  if (!published) return null
  if (!Number.isSafeInteger(published.id) || Number(published.id) < 1) {
    throw new Error(`Stable release ${tag} has an invalid API ID.`)
  }
  const pages = readGhJson<ReadonlyArray<ReadonlyArray<{ name?: string }>>>([
    'api',
    '--paginate',
    '--slurp',
    '--method',
    'GET',
    `repos/${context.repository}/releases/${published.id}/assets`,
    '-f',
    'per_page=100'
  ])
  return toStableReleaseSnapshot(
    published,
    pages.flat().map(asset => String(asset.name ?? ''))
  )
}

const stableReleaseIsComplete = (
  context: ReleaseContext,
  release: ReleaseMerge
) =>
  stableReleaseSnapshotIsComplete(
    release.tag,
    readStableReleaseSnapshot(context, release.tag) ?? undefined
  )

const findOldestIncompleteStableRelease = (
  context: ReleaseContext,
  stableTags: readonly string[]
): ReleaseMerge | null => {
  const releases = listStableReleaseSnapshots(context)
  while (true) {
    const tag = selectOldestIncompleteStableTag({ releases, tags: stableTags })
    if (!tag) return null
    const release = verifyPublishedTag(context, tag)
    const current = readStableReleaseSnapshot(context, tag)
    if (!current || !stableReleaseSnapshotIsComplete(tag, current)) {
      return release
    }
    const index = releases.findIndex(candidate => candidate.tag === tag)
    if (index === -1) releases.push(current)
    else releases[index] = current
  }
}

const remoteBranchCommit = (branch: string) => {
  const output = readGit([
    'ls-remote',
    '--heads',
    'origin',
    `refs/heads/${branch}`
  ])
  return output
    ? requireSha(output.split(/\s+/u)[0], 'remote release branch SHA')
    : ''
}

const ensureReleaseBranch = (branch: string, releaseSha: string) => {
  if (!releaseBranchPattern.test(branch)) {
    throw new Error(`Invalid automatic release branch: ${branch}.`)
  }
  const normalizedReleaseSha = requireSha(releaseSha, 'release commit SHA')
  const remote = remoteBranchCommit(branch)
  if (remote && remote !== normalizedReleaseSha) {
    throw new Error(
      `Remote branch ${branch} points to ${remote}, expected ${normalizedReleaseSha}.`
    )
  }
  if (!remote) {
    writeGit(['push', 'origin', `${normalizedReleaseSha}:refs/heads/${branch}`])
  }
  if (remoteBranchCommit(branch) !== normalizedReleaseSha) {
    throw new Error(`Failed to publish exact release branch ${branch}.`)
  }
}

const deleteReleaseBranch = (branch: string, releaseSha: string) => {
  if (!releaseBranchPattern.test(branch)) {
    throw new Error(`Invalid automatic release branch: ${branch}.`)
  }
  const expected = requireSha(releaseSha, 'release commit SHA')
  const remote = remoteBranchCommit(branch)
  if (!remote) return
  if (remote !== expected) {
    throw new Error(
      `Remote branch ${branch} points to ${remote}, expected ${expected}.`
    )
  }
  writeGit([
    'push',
    'origin',
    `--force-with-lease=refs/heads/${branch}:${expected}`,
    `:refs/heads/${branch}`
  ])
}

const listReleasePullRequests = (context: ReleaseContext, branch: string) =>
  readGhJson<PullRequest[]>([
    'api',
    '--method',
    'GET',
    `repos/${context.repository}/pulls`,
    '-f',
    'state=all',
    '-f',
    `head=${context.owner}:${branch}`,
    '-f',
    'base=main',
    '-f',
    'per_page=100'
  ])

const createOrRecoverPullRequest = ({
  branch,
  context,
  releaseSha,
  tag
}: {
  readonly branch: string
  readonly context: ReleaseContext
  readonly releaseSha: string
  readonly tag: string
}) => {
  const existing = listReleasePullRequests(context, branch)
  if (existing.length > 1) {
    throw new Error(`Multiple pull requests use release branch ${branch}.`)
  }
  let pullRequest =
    existing[0] ??
    writeGhJson<PullRequest>([
      'api',
      '--method',
      'POST',
      `repos/${context.repository}/pulls`,
      '-f',
      `title=chore(release): cut ${normalizeStableTag(tag)}`,
      '-f',
      `head=${branch}`,
      '-f',
      'base=main',
      '-f',
      `body=Automatic stable release generated from verified CI run ${context.runId}.`
    ])
  if (pullRequest.state === 'closed' && !pullRequest.merged_at) {
    assertAutomationPullRequest({
      branch,
      pullRequest,
      releaseSha,
      repository: context.repository
    })
    pullRequest = writeGhJson<PullRequest>([
      'api',
      '--method',
      'PATCH',
      `repos/${context.repository}/pulls/${pullRequest.number}`,
      '-f',
      'state=open'
    ])
  }
  return assertAutomationPullRequest({
    branch,
    pullRequest,
    releaseSha,
    repository: context.repository
  })
}

const waitForMergeablePullRequest = async ({
  branch,
  context,
  number,
  releaseSha
}: {
  readonly branch: string
  readonly context: ReleaseContext
  readonly number: number
  readonly releaseSha: string
}) => {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    fetchRemoteMain()
    const currentMain = requireSha(
      readGit(['rev-parse', 'origin/main']),
      'remote main SHA'
    )
    if (currentMain !== context.sourceSha) return null
    const pullRequest = assertAutomationPullRequest({
      branch,
      pullRequest: readGhJson<PullRequest>([
        'api',
        `repos/${context.repository}/pulls/${number}`
      ]),
      releaseSha,
      repository: context.repository
    })
    if (pullRequest.state !== 'open') {
      throw new Error(`Release PR #${number} is not open.`)
    }
    if (pullRequest.mergeable === true) return pullRequest
    if (pullRequest.mergeable === false) {
      throw new Error(
        `Release PR #${number} is not mergeable (${pullRequest.mergeable_state ?? 'unknown'}).`
      )
    }
    if (attempt < 12) await sleep(5_000)
  }
  throw new Error(`GitHub did not calculate mergeability for PR #${number}.`)
}

const mergeReleasePullRequest = async (
  args: ReturnType<typeof createMergePullRequestArguments>
) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return writeGhJson<{ merged?: boolean; sha?: string }>(args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt === 3 || !/HTTP (?:405|409)/u.test(message)) throw error
      await sleep(5_000)
    }
  }
  throw new Error('GitHub did not merge the automatic release PR.')
}

const createReleaseCommit = ({
  context,
  plan
}: {
  readonly context: ReleaseContext
  readonly plan: Extract<
    ReturnType<typeof createStableReleasePlan>,
    { status: 'prepared' }
  >
}) => {
  writeFileSync(
    resolve(rootDir, 'package.json'),
    `${JSON.stringify(plan.manifest, null, 2)}\n`
  )
  writeFileSync(resolve(rootDir, 'CHANGELOG.md'), plan.changelog)
  writeGit(['add', '--', ...releaseFiles])
  assertReleaseChangedFiles(
    splitLines(readGit(['diff', '--cached', '--name-only']))
  )
  const timestamp = readGit(['show', '-s', '--format=%cI', context.sourceSha])
  writeGit(
    [
      '-c',
      'user.name=github-actions[bot]',
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      `chore(release): cut ${plan.tag}`,
      '-m',
      '[skip ci]'
    ],
    {
      env: {
        GIT_AUTHOR_DATE: timestamp,
        GIT_COMMITTER_DATE: timestamp
      }
    }
  )
  const releaseSha = requireSha(
    readGit(['rev-parse', 'HEAD']),
    'release commit SHA'
  )
  const parents = readParents(releaseSha)
  if (parents.length !== 2 || parents[1] !== context.sourceSha) {
    throw new Error('Release commit does not descend from the verified source.')
  }
  assertReleaseChangedFiles(
    splitLines(readGit(['diff', '--name-only', context.sourceSha, releaseSha]))
  )
  return releaseSha
}

const closeStalePullRequest = ({
  branch,
  context,
  pullRequest,
  releaseSha
}: {
  readonly branch: string
  readonly context: ReleaseContext
  readonly pullRequest: PullRequest
  readonly releaseSha: string
}) => {
  if (pullRequest.state === 'open') {
    writeGhJson<PullRequest>([
      'api',
      '--method',
      'PATCH',
      `repos/${context.repository}/pulls/${pullRequest.number}`,
      '-f',
      'state=closed'
    ])
  }
  deleteReleaseBranch(branch, releaseSha)
}

const cleanupOrphanedReleasePullRequests = (context: ReleaseContext) => {
  const pages = readGhJson<PullRequest[][]>([
    'api',
    '--paginate',
    '--slurp',
    '--method',
    'GET',
    `repos/${context.repository}/pulls`,
    '-f',
    'state=open',
    '-f',
    'base=main',
    '-f',
    'per_page=100'
  ])
  for (const pullRequest of pages.flat()) {
    const branch = String(pullRequest.head?.ref ?? '')
    const releaseSha = String(pullRequest.head?.sha ?? '')
    const currentSourceSuffix = `-${context.sourceSha.slice(0, 12)}`
    if (
      !releaseBranchPattern.test(branch) ||
      branch.endsWith(currentSourceSuffix) ||
      !releaseSubjectPattern.test(String(pullRequest.title ?? '')) ||
      !botLogins.has(String(pullRequest.user?.login ?? '')) ||
      pullRequest.head?.repo?.full_name !== context.repository ||
      pullRequest.base?.ref !== 'main' ||
      pullRequest.base?.repo?.full_name !== context.repository ||
      !Number.isSafeInteger(pullRequest.number) ||
      Number(pullRequest.number) < 1 ||
      !shaPattern.test(releaseSha)
    ) {
      continue
    }
    closeStalePullRequest({
      branch,
      context,
      pullRequest,
      releaseSha
    })
  }
}

const completeRelease = async (
  context: ReleaseContext,
  release: ReleaseMerge
) => {
  createAndPushTag(release)
  verifyPublishedTag(context, release.tag)
  deleteReleaseBranch(
    createReleaseBranchName(release.version, release.sourceSha),
    release.releaseSha
  )
  return release
}

const writeResult = (
  context: ReleaseContext,
  result: AutomaticReleaseResult
) => {
  if (context.githubOutput) {
    const values: Readonly<Record<string, string>> = {
      commit: result.commit ?? '',
      continue_release: String(result.continueRelease ?? false),
      publish: String(result.publish),
      status: result.status,
      tag: result.tag ?? '',
      version: result.version ?? ''
    }
    appendFileSync(
      context.githubOutput,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
        .concat('\n')
    )
  }
  console.log(JSON.stringify(result))
  return result
}

const releaseResult = (
  context: ReleaseContext,
  release: ReleaseMerge,
  status: AutomaticReleaseResult['status'],
  continueRelease = false,
  releaseComplete?: boolean
) =>
  writeResult(context, {
    commit: release.releaseSha,
    continueRelease,
    publish: !(releaseComplete ?? stableReleaseIsComplete(context, release)),
    status,
    tag: release.tag,
    version: release.version
  })

export const runAutomaticRelease = async () => {
  const context = parseAutomaticReleaseContext()
  const trustedCheckout = requireSha(
    readGit(['rev-parse', 'HEAD']),
    'trusted workflow checkout SHA'
  )
  if (readGit(['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('Automatic release requires a clean trusted checkout.')
  }
  fetchRemoteMain({ tags: true })
  const remoteMain = requireSha(
    readGit(['rev-parse', 'origin/main']),
    'remote main SHA'
  )
  if (!isGitAncestor(trustedCheckout, remoteMain)) {
    throw new Error('Automatic release code must come from protected main.')
  }
  verifySourceWorkflowRun(context)
  if (!isGitAncestor(context.sourceSha, remoteMain)) {
    throw new Error('Verified CI source must be reachable from protected main.')
  }
  writeGit(['checkout', '--detach', context.sourceSha])
  const checkoutHead = requireSha(
    readGit(['rev-parse', 'HEAD']),
    'workflow checkout SHA'
  )
  if (checkoutHead !== context.sourceSha) {
    throw new Error(
      `Workflow checkout ${checkoutHead} does not match ${context.sourceSha}.`
    )
  }
  if (readGit(['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('Automatic release requires a clean checkout.')
  }
  cleanupOrphanedReleasePullRequests(context)
  const stableTags = listStableTags('origin/main')
  const incompleteRelease = findOldestIncompleteStableRelease(
    context,
    stableTags
  )
  if (incompleteRelease) {
    return releaseResult(context, incompleteRelease, 'recovered', true, false)
  }
  const coveringRelease = findReleaseCoveringSource(context, stableTags)
  if (coveringRelease) {
    const releaseComplete = stableReleaseIsComplete(context, coveringRelease)
    return releaseResult(
      context,
      coveringRelease,
      releaseComplete ? 'already-released' : 'recovered',
      coveringRelease.baseSha !== coveringRelease.sourceSha,
      releaseComplete
    )
  }

  const pendingRelease = findPendingReleaseMerge()
  if (pendingRelease) {
    assertAssociatedReleasePullRequest(context, pendingRelease)
    await completeRelease(context, pendingRelease)
    const hasMorePendingReleases = findPendingReleaseMerge() !== null
    return releaseResult(
      context,
      pendingRelease,
      'recovered',
      hasMorePendingReleases ||
        pendingRelease.baseSha !== pendingRelease.sourceSha ||
        !releaseBaseCoversSource({
          baseSha: pendingRelease.baseSha,
          sourceSha: context.sourceSha
        })
    )
  }

  const baselineTag = latestStableTag(context.sourceSha)
  if (baselineTag) verifyPublishedTag(context, baselineTag)
  const messages = createReleaseMessageRanges({
    baselineTag,
    sourceSha: context.sourceSha
  }).flatMap(revision =>
    readGit(['log', revision, '--no-merges', '--format=%B%x00'])
      .split('\u0000')
      .map(message => message.trim())
      .filter(Boolean)
  )
  const plan = createStableReleasePlan({
    baselineTag,
    changelog: readFileSync(resolve(rootDir, 'CHANGELOG.md'), 'utf8'),
    currentManifest: JSON.parse(
      readFileSync(resolve(rootDir, 'package.json'), 'utf8')
    ) as Record<string, unknown>,
    date: readGit(['show', '-s', '--format=%cs', context.sourceSha]),
    messages
  })
  for (const subject of plan.ignoredCommits) {
    console.warn(`Ignored non-conventional commit: ${subject}`)
  }
  if (plan.status === 'skipped') {
    return writeResult(context, { publish: false, status: 'skipped' })
  }

  const releaseSha = createReleaseCommit({ context, plan })
  const branch = createReleaseBranchName(plan.version, context.sourceSha)
  ensureReleaseBranch(branch, releaseSha)
  const pullRequest = createOrRecoverPullRequest({
    branch,
    context,
    releaseSha,
    tag: plan.tag
  })

  const mergeablePullRequest = await waitForMergeablePullRequest({
    branch,
    context,
    number: Number(pullRequest.number),
    releaseSha
  })
  if (!mergeablePullRequest) {
    closeStalePullRequest({
      branch,
      context,
      pullRequest,
      releaseSha
    })
    return writeResult(context, {
      continueRelease: true,
      publish: false,
      status: 'stale'
    })
  }

  const merge = await mergeReleasePullRequest(
    createMergePullRequestArguments({
      branch,
      number: Number(pullRequest.number),
      releaseSha,
      repository: context.repository,
      tag: plan.tag
    })
  )
  if (merge.merged !== true) {
    throw new Error(`GitHub did not merge release PR #${pullRequest.number}.`)
  }
  const mergeSha = requireSha(merge.sha, 'release merge SHA')
  fetchRemoteMain()
  if (!isGitAncestor(mergeSha, readGit(['rev-parse', 'origin/main']))) {
    throw new Error(`Release merge ${mergeSha} is not reachable from main.`)
  }
  const release = inspectReleaseMerge({
    mergeSha,
    releaseSha,
    tag: plan.tag
  })
  const mergedPullRequest = readGhJson<PullRequest>([
    'api',
    `repos/${context.repository}/pulls/${pullRequest.number}`
  ])
  assertAutomationPullRequest({
    branch,
    mergeSha,
    pullRequest: mergedPullRequest,
    releaseSha,
    repository: context.repository
  })
  await completeRelease(context, release)
  return releaseResult(
    context,
    release,
    'released',
    release.baseSha !== release.sourceSha
  )
}

const isMainModule = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isMainModule) {
  try {
    await runAutomaticRelease()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
