import { describe, expect, it } from 'vitest'

import {
  assertStableReleaseTransition,
  createStableReleasePlan,
  deriveNextStableVersion,
  deriveReleaseBump,
  extractReleaseNotes,
  normalizeStableTag,
  ReleaseNotesOutputExistsError,
  writeReleaseNotesOutput
} from '../../scripts/release/versioning'

const emptyChangelog = `# Changelog

Significant changes are recorded here.

## Unreleased
`

describe('automatic stable release versioning', () => {
  it('promotes the unpublished sentinel directly to 1.0.0', () => {
    expect(
      deriveNextStableVersion({
        baselineTag: '',
        currentVersion: '0.0.0',
        messages: ['fix(release): automate stable releases']
      })
    ).toEqual({ bump: 'major', version: '1.0.0' })
  })

  it('uses the strongest Conventional Commit bump', () => {
    expect(
      deriveReleaseBump([
        'fix(storage): preserve recovery state',
        'feat(panel): add review filters',
        'docs: clarify installation'
      ])
    ).toBe('minor')
    expect(
      deriveReleaseBump([
        'feat(panel)!: replace the saved-view contract',
        'fix: retain fallback'
      ])
    ).toBe('major')
    expect(deriveReleaseBump(['chore(deps): update actions'])).toBe('patch')
    expect(deriveReleaseBump(['docs: clarify installation'])).toBeNull()
  })

  it.each([
    ['feat(panel): add review filters', 'minor'],
    ['fix(storage): preserve recovery state', 'patch'],
    ['perf(graph): reduce eviction passes', 'patch'],
    ['revert: restore the previous parser', 'patch'],
    ['build(deps): update runtime packages', 'patch'],
    ['build(deps-dev): update test packages', 'patch'],
    ['chore(deps): update runtime packages', 'patch'],
    ['chore(deps-dev): update test packages', 'patch'],
    ['docs: clarify installation', null],
    ['ci: pin the release action', null],
    ['test: cover stable releases', null],
    ['style: format release scripts', null],
    ['refactor: simplify release scripts', null],
    ['build: update build configuration', null],
    ['chore: initialize repository', null]
  ] as const)('maps %s to %s', (message, bump) => {
    expect(deriveReleaseBump([message])).toBe(bump)
  })

  it.each(['BREAKING CHANGE', 'BREAKING-CHANGE'])(
    'treats a strict %s footer as major even with a non-conventional subject',
    footer => {
      const message = `Update the portable profile format\n\n${footer}: profiles now use schema 2`
      expect(deriveReleaseBump([message])).toBe('major')

      const plan = createStableReleasePlan({
        baselineTag: 'v1.2.3',
        changelog: emptyChangelog,
        currentManifest: { name: 'content-lens', version: '1.2.3' },
        date: '2026-08-13',
        messages: [message]
      })

      expect(plan.status).toBe('prepared')
      if (plan.status !== 'prepared') throw new Error('release was skipped')
      expect(plan.bump).toBe('major')
      expect(plan.ignoredCommits).toEqual([])
      expect(extractReleaseNotes(plan.changelog, '2.0.0')).toBe(
        '### Changed\n\n- Update the portable profile format'
      )
    }
  )

  it.each([
    [
      'feat(sync): rotate provider tokens',
      '',
      'BREAKING CHANGE: stored sync tokens are re-issued.',
      '',
      'Existing profiles must be re-imported.'
    ].join('\n'),
    [
      'fix(storage): drop the legacy profile key',
      '',
      'BREAKING CHANGE: profiles now use schema 2',
      '',
      'Refs: CL-42'
    ].join('\n'),
    [
      'fix(storage): drop the legacy profile key',
      '',
      'Refs: CL-42',
      'BREAKING-CHANGE: profiles now use schema 2'
    ].join('\n')
  ])('recognizes a breaking token in a final footer block', message => {
    expect(deriveReleaseBump([message])).toBe('major')
  })

  it.each([
    'refactor: update the profile format\n\nBREAKINGCHANGE: profiles now use schema 2',
    'refactor: update the profile format\n\nBREAKING CHANGE:\nprofiles now use schema 2',
    'refactor: update the profile format\n\nBREAKING CHANGE:   \nmore text'
  ])('rejects a malformed breaking footer in %s', message => {
    expect(deriveReleaseBump([message])).toBeNull()
  })

  it.each([
    [
      'refactor: document release commits',
      '',
      'Example:',
      'BREAKING CHANGE: profiles now use schema 2',
      '',
      'This is explanatory body text.'
    ].join('\n'),
    [
      'refactor: document release commits',
      '',
      '```text',
      'BREAKING CHANGE: profiles now use schema 2',
      '```'
    ].join('\n'),
    [
      'refactor: document release commits',
      '',
      '```text',
      '',
      'BREAKING CHANGE: profiles now use schema 2',
      '```'
    ].join('\n')
  ])('ignores a breaking footer example in the commit body', message => {
    expect(deriveReleaseBump([message])).toBeNull()
  })

  it('moves curated Unreleased notes into the generated stable version', () => {
    const plan = createStableReleasePlan({
      baselineTag: '',
      changelog: `${emptyChangelog}\n### Added\n\n- Initial extension.\n`,
      currentManifest: { name: 'content-lens', version: '0.0.0' },
      date: '2026-08-13',
      messages: ['feat(extension): ship initial extension']
    })

    expect(plan.status).toBe('prepared')
    if (plan.status !== 'prepared') throw new Error('release was skipped')
    expect(plan.version).toBe('1.0.0')
    expect(plan.manifest.version).toBe('1.0.0')
    expect(plan.changelog).toContain(
      '## Unreleased\n\n## 1.0.0 - 2026-08-13\n\n### Added'
    )
    expect(extractReleaseNotes(plan.changelog, '1.0.0')).toBe(
      '### Added\n\n- Initial extension.'
    )
    expect(plan.changelog.endsWith('\n')).toBe(true)
    expect(plan.changelog.endsWith('\n\n')).toBe(false)
  })

  it('generates sanitized notes when Unreleased is empty', () => {
    const plan = createStableReleasePlan({
      baselineTag: 'v1.2.3',
      changelog: `${emptyChangelog}\n## 1.2.3 - 2026-08-01\n\n### Fixed\n\n- Previous fix.\n`,
      currentManifest: { name: 'content-lens', version: '1.2.3' },
      date: '2026-08-13',
      messages: ['fix(api): escape @team, #42 and <script>']
    })

    expect(plan.status).toBe('prepared')
    if (plan.status !== 'prepared') throw new Error('release was skipped')
    expect(plan.version).toBe('1.2.4')
    expect(extractReleaseNotes(plan.changelog, '1.2.4')).toContain(
      'escape &#64;team, &#35;42 and &lt;script&gt;'
    )
  })

  it('ignores a release heading with a leading zero', () => {
    const changelog = `${emptyChangelog}
## 01.2.3 - 2026-08-13

### Fixed

- Invalid heading.
`
    expect(() => extractReleaseNotes(changelog, '1.2.3')).toThrow(
      'does not contain release 1.2.3'
    )
  })

  it.each([
    ['# Rewrite storage', '\\# Rewrite storage'],
    ['> Rewrite storage', '&gt; Rewrite storage'],
    ['- Rewrite storage', '\\- Rewrite storage'],
    ['+ Rewrite storage', '\\+ Rewrite storage'],
    ['* Rewrite storage', '\\* Rewrite storage'],
    ['1. Rewrite storage', '1\\. Rewrite storage'],
    ['```text', '\\```text'],
    ['---', '\\---'],
    ['_ _ _', '\\_ _ _']
  ])('neutralizes the leading Markdown block in %s', (subject, summary) => {
    const plan = createStableReleasePlan({
      baselineTag: 'v1.2.3',
      changelog: emptyChangelog,
      currentManifest: { name: 'content-lens', version: '1.2.3' },
      date: '2026-08-13',
      messages: [`${subject}\n\nBREAKING CHANGE: profiles now use schema 2`]
    })

    expect(plan.status).toBe('prepared')
    if (plan.status !== 'prepared') throw new Error('release was skipped')
    expect(extractReleaseNotes(plan.changelog, '2.0.0')).toBe(
      `### Changed\n\n- ${summary}`
    )
  })

  it('generates sections in a stable order and ends with one newline', () => {
    const plan = createStableReleasePlan({
      baselineTag: 'v1.2.3',
      changelog: `${emptyChangelog}\n## 1.2.3 - 2026-08-01\n\n### Fixed\n\n- Previous fix.\n`,
      currentManifest: { name: 'content-lens', version: '1.2.3' },
      date: '2026-08-13',
      messages: [
        'fix(api): escape @team, #42 & <script> in [docs](https://api.example.com)',
        'feat(panel): add review filters',
        'refactor(storage)!: remove the legacy profile key'
      ]
    })

    expect(plan.status).toBe('prepared')
    if (plan.status !== 'prepared') throw new Error('release was skipped')
    expect(plan.changelog).toBe(`# Changelog

Significant changes are recorded here.

## Unreleased

## 2.0.0 - 2026-08-13

### Added

- add review filters

### Changed

- remove the legacy profile key

### Fixed

- escape &#64;team, &#35;42 &amp; &lt;script&gt; in docs

## 1.2.3 - 2026-08-01

### Fixed

- Previous fix.
`)
  })

  it('skips histories without a release-worthy commit', () => {
    expect(
      createStableReleasePlan({
        baselineTag: 'v1.2.3',
        changelog: emptyChangelog,
        currentManifest: { name: 'content-lens', version: '1.2.3' },
        date: '2026-08-13',
        messages: ['docs: clarify release behavior']
      })
    ).toEqual({ ignoredCommits: [], status: 'skipped' })
  })

  it('reports only non-conventional commits without a breaking footer', () => {
    expect(
      createStableReleasePlan({
        baselineTag: 'v1.2.3',
        changelog: emptyChangelog,
        currentManifest: { name: 'content-lens', version: '1.2.3' },
        date: '2026-08-13',
        messages: ['Update the readme', 'docs: clarify release behavior']
      })
    ).toEqual({ ignoredCommits: ['Update the readme'], status: 'skipped' })
  })

  it('rejects drift between package version and the latest stable tag', () => {
    expect(() =>
      deriveNextStableVersion({
        baselineTag: 'v1.2.3',
        currentVersion: '1.2.2',
        messages: ['fix: repair versioning']
      })
    ).toThrow('does not match latest tag')
  })

  it('accepts only normalized stable tags', () => {
    expect(normalizeStableTag(' v1.2.3 ')).toBe('v1.2.3')
    expect(() => normalizeStableTag('1.2.3')).toThrow('Unsupported stable tag')
    expect(() => normalizeStableTag('v1.2.3-beta.1')).toThrow(
      'Unsupported stable version'
    )
  })

  it('names an existing release-notes output without hiding other errors', () => {
    const existsError = Object.assign(new Error('already exists'), {
      code: 'EEXIST'
    })
    const failWithExists = () => {
      throw existsError
    }
    expect(() =>
      writeReleaseNotesOutput('release-notes.md', 'notes', failWithExists)
    ).toThrow(ReleaseNotesOutputExistsError)
    expect(() =>
      writeReleaseNotesOutput('release-notes.md', 'notes', failWithExists)
    ).toThrow('Release notes output already exists: release-notes.md.')

    const unrelatedError = Object.assign(new Error('permission denied'), {
      code: 'EACCES'
    })
    let thrown: unknown
    try {
      writeReleaseNotesOutput('release-notes.md', 'notes', () => {
        throw unrelatedError
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(unrelatedError)
  })

  it('creates release notes exclusively with one trailing newline', () => {
    const writes: unknown[] = []
    writeReleaseNotesOutput('release-notes.md', 'notes', (...args) => {
      writes.push(args)
    })

    expect(writes).toEqual([['release-notes.md', 'notes\n', { flag: 'wx' }]])
  })

  it('accepts only one supported stable version transition', () => {
    const changelog = `${emptyChangelog}\n## 1.3.0 - 2026-08-13\n\n### Added\n\n- Filters.\n`
    expect(
      assertStableReleaseTransition({
        changelog,
        currentVersion: '1.3.0',
        previousVersion: '1.2.3'
      })
    ).toBe('1.3.0')
    expect(() =>
      assertStableReleaseTransition({
        changelog,
        currentVersion: '1.3.0',
        previousVersion: '1.0.0'
      })
    ).toThrow('is unsupported')
  })
})
