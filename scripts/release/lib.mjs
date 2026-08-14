import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

export const PUBLIC_CHANNELS = new Set(['stable'])
export const RELEASE_FILES = Object.freeze({
  manifest: 'release-manifest.json',
  provenance: 'provenance.intoto.json',
  sbom: 'sbom.spdx.json',
  checksums: 'checksums.sha256'
})

export const parseArgs = argv => {
  const values = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) {
      values._.push(argument)
      continue
    }
    const key = argument.slice(2)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      values[key] = next
      index += 1
    } else {
      values[key] = true
    }
  }
  return values
}

export const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
    stdio: options.capture ? 'pipe' : 'inherit',
    env: { ...process.env, ...options.env }
  })
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : ''
    throw new Error(
      `${command} ${args.join(' ')} failed with status ${result.status}.${detail}`
    )
  }
  return options.capture ? result.stdout.trim() : ''
}

export const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

export const stableJson = value => `${JSON.stringify(value, null, 2)}\n`

export const sha256File = async path => {
  const content = await readFile(path)
  return createHash('sha256').update(content).digest('hex')
}

export const assertRegularFile = async path => {
  const details = await stat(path).catch(() => null)
  if (!details?.isFile()) {
    throw new Error(`Required file is missing: ${path}`)
  }
}

export const getPackage = async (root = process.cwd()) =>
  readJson(resolve(root, 'package.json'))

export const artifactNames = version => [
  `content-lens-${version}-chrome.zip`,
  `content-lens-${version}-firefox.zip`,
  `content-lens-${version}-sources.zip`
]

export const git = (root, ...args) =>
  run('git', args, { cwd: root, capture: true })

export const tryGit = (root, ...args) => {
  try {
    return git(root, ...args)
  } catch {
    return ''
  }
}

export const getGitState = (root = process.cwd()) => ({
  branch: git(root, 'branch', '--show-current'),
  commit: git(root, 'rev-parse', 'HEAD'),
  dirty: git(root, 'status', '--porcelain').length > 0,
  tag: tryGit(root, 'describe', '--tags', '--exact-match', 'HEAD')
})

export const validateVersion = version => {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version)) {
    throw new Error(`Invalid package version: ${version}`)
  }
}

export const validateRelease = ({
  root = process.cwd(),
  channel,
  version,
  allowDirty = false
}) => {
  if (!['dev', 'stable'].includes(channel)) {
    throw new Error(`Invalid release channel: ${channel}`)
  }
  validateVersion(version)
  const state = getGitState(root)
  if (state.dirty && !allowDirty) {
    throw new Error('Release packages require a clean worktree.')
  }
  if (PUBLIC_CHANNELS.has(channel)) {
    if (allowDirty) {
      throw new Error('--allow-dirty is restricted to the dev channel.')
    }
    const expectedTag = `v${version}`
    if (state.tag !== expectedTag) {
      throw new Error(`Public release requires the exact tag ${expectedTag}.`)
    }
    const tagType = git(root, 'cat-file', '-t', expectedTag)
    if (tagType !== 'tag') {
      throw new Error(`Public release tag ${expectedTag} must be annotated.`)
    }
    const mainRef = tryGit(root, 'rev-parse', 'main') ? 'main' : 'origin/main'
    const mainCommit = git(root, 'rev-parse', mainRef)
    const ancestor = run(
      'git',
      ['merge-base', '--is-ancestor', state.commit, mainCommit],
      {
        cwd: root,
        capture: true
      }
    )
    void ancestor
  }
  return state
}

export const toPosix = path => path.replaceAll('\\', '/')
