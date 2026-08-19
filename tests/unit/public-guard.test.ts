import { describe, expect, it } from 'vitest'

import {
  runPublicGuard,
  scanArchiveContents,
  scanPath,
  scanText,
  validateFixtureMetadata
} from '../../scripts/ci/public-guard'

const findingCodes = (findings: ReturnType<typeof scanText>): string[] =>
  findings.map(item => item.code)

describe('public repository guard', () => {
  it('accepts ordinary project text and allowlisted public sources', () => {
    const content = [
      'ContentLens keeps processing local.',
      'Source: https://github.com/everton-dgn/content-lens',
      'Platform boundary: https://www.youtube.com/*',
      'Tokens: https://www.designtokens.org/tr/drafts/format/',
      'Components: https://carbondesignsystem.com/designing/get-started/',
      'Screen reader: https://support.apple.com/guide/voiceover/welcome/mac'
    ].join('\n')

    expect(scanText('docs/source.md', content)).toEqual([])
  })

  it('accepts reserved synthetic domains and the single privileged network boundary', () => {
    expect(
      scanText(
        'tests/contract/provider.test.ts',
        'https://provider.example/path\nhttps://browser-runtime.invalid/path'
      )
    ).toEqual([])
    expect(
      scanText(
        'src/ai/providers/request-policy.ts',
        'export const request = () => fetch(url);'
      )
    ).toEqual([])
    expect(
      scanText(
        'src/application/provider-management/connection-test.ts',
        'export type Input = { fetchImpl?: typeof fetch };'
      )
    ).toEqual([])
    expect(
      findingCodes(scanText('src/ai/providers/other-client.ts', 'fetch(url);'))
    ).toContain('unapproved-network-client')
  })

  it('lets the i18n loader read packaged catalogs but not a remote endpoint', () => {
    const request = ['fet', 'ch'].join('')
    const packagedRead = `const r = await ${request}(browser.runtime.getURL(path));`
    const remoteRead = `${packagedRead} const remote = await ${request}(endpoint);`

    expect(
      findingCodes(scanText('src/i18n/load.ts', packagedRead))
    ).not.toContain('unapproved-network-client')
    expect(findingCodes(scanText('src/i18n/load.ts', remoteRead))).toContain(
      'unapproved-network-client'
    )
    expect(findingCodes(scanText('src/i18n/other.ts', packagedRead))).toContain(
      'unapproved-network-client'
    )
  })

  it.each([
    ['navigator.sendBeacon', 'navigator.sendBeacon(endpoint, body);'],
    ['optional-chained sendBeacon', 'navigator?.sendBeacon(endpoint, body);'],
    ['spaced optional chain', 'navigator ?. sendBeacon (endpoint, body);']
  ])('reports %s even in the packaged-catalog reader', (_label, beacon) => {
    const request = ['fet', 'ch'].join('')
    const packagedRead = `const r = await ${request}(browser.runtime.getURL(path));`

    expect(
      findingCodes(scanText('src/i18n/load.ts', `${packagedRead} ${beacon}`))
    ).toContain('unapproved-network-client')
  })

  it('accepts only reviewed provider patterns and loopback references in their exact files', () => {
    const httpsPattern = ['https', '://', '*', '/*'].join('')
    const httpPattern = ['http', '://', '*', '/*'].join('')
    const loopback = ['http', '://', '127', '.0.0.1:11434'].join('')
    expect(
      scanText(
        'src/config/manifest.ts',
        `const patterns = [${JSON.stringify(httpsPattern)}, ${JSON.stringify(
          httpPattern
        )}];`
      )
    ).toEqual([])
    expect(
      scanText(
        'src/ai/providers/templates.ts',
        `const endpoint = ${JSON.stringify(loopback)};`
      )
    ).toEqual([])
    expect(
      findingCodes(
        scanText(
          'src/unreviewed-provider.ts',
          `const endpoint = ${JSON.stringify(loopback)};`
        )
      )
    ).toEqual(
      expect.arrayContaining([
        'private-network-reference',
        'unapproved-public-url'
      ])
    )
    expect(
      findingCodes(
        scanText(
          'docs/unreviewed-pattern.md',
          `Provider access: ${httpsPattern}`
        )
      )
    ).toContain('unapproved-public-url')
  })

  it('scopes README public exceptions to their exact path and values', () => {
    const stableReleaseBadge = [
      'https',
      '://img.shields.io/github/v/release/everton-dgn/content-lens?label=stable'
    ].join('')
    const licenseBadge = [
      'https',
      '://img.shields.io/github/license/everton-dgn/content-lens'
    ].join('')
    const readmeContent = [
      `[![Latest release](${stableReleaseBadge})](https://github.com/everton-dgn/content-lens/releases/latest)`,
      `[![License](${licenseBadge})](LICENSE)`,
      ['https', '://', '*', '/*'].join(''),
      ['http', '://', '*', '/*'].join(''),
      ['local', 'host'].join('')
    ].join('\n')

    expect(scanText('README.md', readmeContent)).toEqual([])
    expect(
      findingCodes(scanText('docs/unreviewed-readme-copy.md', readmeContent))
    ).toEqual(
      expect.arrayContaining([
        'private-network-reference',
        'unapproved-public-url'
      ])
    )
  })

  it('keeps network acquisition forbidden across every RSS runtime boundary', () => {
    const networkCall = 'export const acquire = () => fetch(feedUrl);'
    const paths = [
      'src/adapters/rss/network.ts',
      'src/application/feed-subscriptions/acquisition.ts',
      'src/extension/service-worker/rss-runtime.ts'
    ]

    for (const path of paths) {
      expect(findingCodes(scanText(path, networkCall)), path).toContain(
        'rss-network-acquisition-forbidden'
      )
    }
  })

  it.each([
    ['an aliased global', 'const request = fetch; request(feedUrl);'],
    ['a computed global property', "globalThis['fet' + 'ch'](feedUrl);"],
    [
      'the approved provider client',
      "import { request } from '@/ai/providers/request-policy'; request(feedUrl);"
    ],
    [
      'the approved sync client',
      "export { ConditionalHttpProvider } from '../../sync/providers/conditional-http';"
    ],
    [
      'a dynamic approved client import',
      "const client = import('@/ai/providers/request-policy');"
    ],
    [
      'a direct client after a template literal type',
      [
        'type Segment = `',
        '$',
        '{1 | 2}xx`; export const acquire = () => fetch(feedUrl);'
      ].join('')
    ]
  ])('blocks RSS acquisition through %s', (_label, content) => {
    expect(
      findingCodes(scanText('src/adapters/rss/acquisition.ts', content))
    ).toContain('rss-network-acquisition-forbidden')
  })

  it('scopes sensitive fixture URLs to the exact reviewed test file', () => {
    const fixtureUrl = ['https', '://www.youtube.com/watch?v=classifier'].join(
      ''
    )

    expect(
      scanText(
        'tests/contract/classifier.test.ts',
        `canonicalUrl: ${JSON.stringify(fixtureUrl)}`
      )
    ).toEqual([])
    expect(
      findingCodes(
        scanText(
          'tests/contract/unreviewed-classifier.test.ts',
          `canonicalUrl: ${JSON.stringify(fixtureUrl)}`
        )
      )
    ).toContain('unapproved-public-url')
  })

  it('accepts the exact public sources cited by normative contracts', () => {
    const content = [
      'https://ai.google.dev/gemini-api/docs/structured-output',
      'https://api.anthropic.com',
      'https://api.openai.com',
      'https://api.example.com',
      'https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html',
      'https://chromewebstore.google.com/detail/example-extension',
      'https://developers.openai.com/api/docs/guides/structured-outputs',
      'https://docs.github.com/en/rest/repos/contents',
      'https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety',
      'https://help.raindrop.io/install-extension',
      'https://generativelanguage.googleapis.com',
      'https://news.ycombinator.com/',
      'https://platform.claude.com/docs/en/build-with-claude/structured-outputs',
      'https://platform.openai.com/docs/quickstart/make-your-first-api-request',
      'https://policies.google.com/privacy',
      'https://proxy.example.net',
      'https://privacy.anthropic.com/en/',
      'https://support.claude.com/en/articles/9767949-api-key-best-practices-keeping-your-keys-safe-and-secure',
      'https://www.linkedin.com/*',
      'https://www.reddit.com/*',
      'https://www.w3.org/TR/WCAG22/',
      'https://x.com/*'
    ].join('\n')

    expect(scanText('docs/public-sources.md', content)).toEqual([])
  })

  it('accepts inert standards identifiers embedded by build dependencies', () => {
    const content = [
      'http://json-schema.org/draft-07/schema#',
      'http://www.w3.org/2000/svg',
      ['http', '://[', '$', '{value}]'].join(''),
      'https://json-schema.org/draft/2020-12/schema'
    ].join('\n')

    expect(scanText('artifacts/extension/chunk.js', content)).toEqual([])
  })

  it.each([
    [
      'provider credential',
      'docs/example.md',
      `token="${['public', 'guard', 'canary'].join('_')}"`,
      'literal-secret-assignment'
    ],
    [
      'JSON credential',
      'docs/example.json',
      `"apiKey": "${['json', 'secret', 'canary'].join('_')}"`,
      'literal-secret-assignment'
    ],
    [
      'local path',
      'docs/example.md',
      ['', 'Users', 'sample', 'project'].join('/'),
      'local-absolute-path'
    ],
    [
      'private host',
      'docs/example.md',
      ['http', '://local', 'host:3000/path'].join(''),
      'private-network-reference'
    ],
    [
      'private IPv6 host',
      'docs/example.md',
      ['http', '://[', 'fd', '00', ':', ':', '1', ']'].join(''),
      'private-network-reference'
    ],
    [
      'personal email',
      'docs/example.md',
      ['person', '@', 'example.com'].join(''),
      'personal-email'
    ],
    [
      'URL query',
      'docs/example.md',
      ['https://github.com/example/project', '?token=value'].join(''),
      'unapproved-public-url'
    ],
    [
      'diagnostic URL field',
      'artifacts/diagnostics/sample.json',
      '{"url":"redacted"}',
      'prohibited-diagnostic-field'
    ],
    [
      'private evidence domain',
      'artifacts/diagnostics/sample.json',
      'api.example.internal',
      'private-domain-reference'
    ],
    [
      'network client',
      'src/network.ts',
      ['fet', 'ch("https://github.com")'].join(''),
      'unapproved-network-client'
    ]
  ])('blocks %s', (_label, path, content, expectedCode) => {
    expect(findingCodes(scanText(path, content))).toContain(expectedCode)
  })

  it('blocks sensitive file paths without reading their content', () => {
    expect(findingCodes(scanPath('.env.production'))).toContain(
      'sensitive-path'
    )
    expect(findingCodes(scanPath('certificates/signing.pem'))).toContain(
      'sensitive-path'
    )
    expect(findingCodes(scanPath('.npmrc'))).toContain('sensitive-path')
    expect(findingCodes(scanPath('.ssh/config'))).toContain('sensitive-path')
  })

  it('fails closed when an explicitly requested path is missing', async () => {
    const findings = await runPublicGuard(
      '/tmp/content-lens-public-guard-missing-root',
      ['missing-release-artifact.zip']
    )

    expect(findings).toEqual([
      {
        code: 'requested-path-missing',
        line: 1,
        path: 'missing-release-artifact.zip'
      }
    ])
  })

  it('accepts synthetic fixture metadata with explicit provenance', () => {
    expect(
      validateFixtureMetadata('tests/fixtures/home.fixture.json', {
        license: 'CC0-1.0',
        schemaVersion: 1,
        source: { kind: 'synthetic' },
        surface: 'youtube-home',
        synthetic: true
      })
    ).toEqual([])
  })

  it('rejects fixture metadata without provenance and licensing', () => {
    expect(
      findingCodes(
        validateFixtureMetadata('tests/fixtures/home.fixture.json', {
          schemaVersion: 1
        })
      )
    ).toEqual(
      expect.arrayContaining([
        'fixture-license',
        'fixture-source-kind',
        'fixture-surface'
      ])
    )
  })

  it('inspects archive paths and text entries without exposing matches', () => {
    const entries = [
      '../escape.txt',
      'extension/.env',
      'extension/manifest.json',
      'sources/config.ts'
    ]
    const contents = new Map([
      [
        'extension/manifest.json',
        Buffer.from('{"homepage_url":"https://github.com/example/project"}')
      ],
      [
        'sources/config.ts',
        Buffer.from(
          `const token = "${['archive', 'secret', 'canary'].join('_')}";`
        )
      ]
    ])

    expect(
      findingCodes(
        scanArchiveContents('artifacts/content-lens.zip', {
          list: () => entries,
          read: entry => contents.get(entry) ?? Buffer.from('')
        })
      )
    ).toEqual(
      expect.arrayContaining([
        'archive-path-traversal',
        'literal-secret-assignment',
        'sensitive-path'
      ])
    )
  })
})
