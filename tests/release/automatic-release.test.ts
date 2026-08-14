import { describe, expect, it } from 'vitest'

import {
  assertReleaseChangedFiles,
  createMergePullRequestArguments,
  createReleaseBranchName,
  createReleaseByTagArguments,
  createReleaseMessageRanges,
  parseAutomaticReleaseContext,
  releaseBaseCoversSource,
  selectOldestPendingRelease,
  stableReleaseAssetNames,
  stableReleaseAssetSetIsExact
} from '../../scripts/release/automatic-release'

const sourceSha = 'a'.repeat(40)

describe('automatic stable release orchestration', () => {
  it('accepts only successful main push CI from this repository', () => {
    expect(
      parseAutomaticReleaseContext({
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'everton-dgn/content-lens',
        RELEASE_SOURCE_BRANCH: 'main',
        RELEASE_SOURCE_CONCLUSION: 'success',
        RELEASE_SOURCE_EVENT: 'push',
        RELEASE_SOURCE_REPOSITORY: 'everton-dgn/content-lens',
        RELEASE_SOURCE_RUN_ID: '42',
        RELEASE_SOURCE_SHA: sourceSha
      })
    ).toMatchObject({
      owner: 'everton-dgn',
      repo: 'content-lens',
      sourceSha
    })

    expect(() =>
      parseAutomaticReleaseContext({
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'everton-dgn/content-lens',
        RELEASE_SOURCE_BRANCH: 'feature',
        RELEASE_SOURCE_CONCLUSION: 'success',
        RELEASE_SOURCE_EVENT: 'pull_request',
        RELEASE_SOURCE_REPOSITORY: 'fork/content-lens',
        RELEASE_SOURCE_RUN_ID: '42',
        RELEASE_SOURCE_SHA: sourceSha
      })
    ).toThrow('must be the current GitHub repository')
  })

  it('creates a branch allowed by the closed release grammar', () => {
    expect(createReleaseBranchName('1.2.3', sourceSha)).toBe(
      'release/v1.2.3-aaaaaaaaaaaa'
    )
    expect(() => createReleaseBranchName('1.2.3-beta.1', sourceSha)).toThrow(
      'Unsupported stable version'
    )
    expect(() => createReleaseBranchName('1.2.3', 'A'.repeat(40))).toThrow(
      'Invalid release source SHA'
    )
  })

  it('merges the exact release commit with normal merge only', () => {
    const args = createMergePullRequestArguments({
      branch: 'release/v1.2.3-aaaaaaaaaaaa',
      number: 17,
      releaseSha: 'b'.repeat(40),
      repository: 'everton-dgn/content-lens',
      tag: 'v1.2.3'
    })

    expect(args).toContain('merge_method=merge')
    expect(args.join(' ')).not.toMatch(/squash|rebase/iu)
    expect(args).toContain(`sha=${'b'.repeat(40)}`)
  })

  it('allows only package.json and CHANGELOG.md in the release payload', () => {
    expect(() =>
      assertReleaseChangedFiles(['package.json', 'CHANGELOG.md'])
    ).not.toThrow()
    expect(() =>
      assertReleaseChangedFiles([
        'package.json',
        'CHANGELOG.md',
        'src/extension/background.ts'
      ])
    ).toThrow('may change only')
  })

  it('requires the complete stable artifact set', () => {
    const expected = [
      'checksums.sha256',
      'content-lens-1.2.3-chrome.zip',
      'content-lens-1.2.3-firefox.zip',
      'content-lens-1.2.3-sources.zip',
      'provenance.intoto.json',
      'release-manifest.json',
      'sbom.spdx.json'
    ]
    expect(stableReleaseAssetNames('1.2.3')).toEqual(expected)
    expect(stableReleaseAssetSetIsExact('1.2.3', expected)).toBe(true)
    expect(
      stableReleaseAssetSetIsExact('1.2.3', [...expected, 'unexpected.txt'])
    ).toBe(false)
  })

  it('continues after recovering a release older than the verified source', () => {
    const releaseSource = 'b'.repeat(40)
    const newerSource = 'c'.repeat(40)
    const ancestry = new Set([`${releaseSource}:${newerSource}`])
    const isAncestor = (ancestor: string, descendant: string) =>
      ancestor === descendant || ancestry.has(`${ancestor}:${descendant}`)

    expect(
      releaseBaseCoversSource({
        baseSha: releaseSource,
        isAncestor,
        sourceSha: releaseSource
      })
    ).toBe(true)
    expect(
      releaseBaseCoversSource({
        baseSha: releaseSource,
        isAncestor,
        sourceSha: newerSource
      })
    ).toBe(false)
  })

  it('reads a stable release directly by tag', () => {
    expect(
      createReleaseByTagArguments({
        repository: 'everton-dgn/content-lens',
        tag: 'v1.2.3'
      })
    ).toContain('repos/everton-dgn/content-lens/releases/tags/v1.2.3')
  })

  it('recovers multiple untagged merges from oldest to newest', () => {
    expect(selectOldestPendingRelease(['newest', 'middle', 'oldest'])).toBe(
      'oldest'
    )
    expect(selectOldestPendingRelease([])).toBeNull()
  })

  it('derives the next release from the tagged version commit', () => {
    expect(
      createReleaseMessageRanges({
        baselineTag: 'v1.2.3',
        sourceSha
      })
    ).toEqual([`v1.2.3..${sourceSha}`])
  })
})
