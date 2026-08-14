import { spawnSync } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createScanner, SyntaxKind } from 'typescript/unstable/ast'

export interface GuardFinding {
  code: string
  line: number
  path: string
}

export interface ArchiveReader {
  list(): string[] | null
  read(entry: string): Buffer | null
}

interface FixtureMetadata {
  license?: unknown
  schemaVersion?: unknown
  source?: {
    kind?: unknown
    url?: unknown
  }
  surface?: unknown
  synthetic?: unknown
}

const allowedUrlHosts = new Set([
  'ai.google.dev',
  'addons.mozilla.org',
  'api.anthropic.com',
  'api.example.com',
  'api.openai.com',
  'biomejs.dev',
  'carbondesignsystem.com',
  'cheatsheetseries.owasp.org',
  'chromewebstore.google.com',
  'chromewebstore.googleapis.com',
  'developer.chrome.com',
  'developer.mozilla.org',
  'developers.openai.com',
  'docs.github.com',
  'extensionworkshop.com',
  'generativelanguage.googleapis.com',
  'github.com',
  'help.openai.com',
  'help.raindrop.io',
  'i.ytimg.com',
  'in-toto.io',
  'news.ycombinator.com',
  'nodejs.org',
  'openai.com',
  'oauth2.googleapis.com',
  'openssf.org',
  'osv.dev',
  'platform.claude.com',
  'platform.openai.com',
  'policies.google.com',
  'playwright.dev',
  'pnpm.io',
  'proxy.example.net',
  'privacy.anthropic.com',
  'raw.githubusercontent.com',
  'react.dev',
  'registry.npmjs.org',
  'spdx.org',
  'slsa.dev',
  'support.apple.com',
  'support.claude.com',
  'support.github.com',
  'tailwindcss.com',
  'typescriptlang.org',
  'ui.shadcn.com',
  'vite.dev',
  'vitest.dev',
  'wxt.dev',
  'www.designtokens.org',
  'www.googleapis.com',
  'www.linkedin.com',
  'www.reddit.com',
  'www.w3.org',
  'www.youtube.com',
  'x.com',
  'youtube.com'
])
const allowedUrlIdentifiers = new Set([
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'http://www.w3.org/2001/XInclude',
  'http://www.w3.org/2005/Atom',
  'http://json-schema.org/draft-04/schema#',
  'http://json-schema.org/draft-07/schema#',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/XML/1998/namespace',
  'https://json-schema.org/draft/2020-12/schema'
])
const optionalHttpsPattern = ['https', '://', '*', '/*'].join('')
const optionalHttpPattern = ['http', '://', '*', '/*'].join('')
const ollamaLoopbackOrigin = ['http', '://', '127', '.0.0.1:11434'].join('')
const remoteHttpExample = ['http', '://remote.example'].join('')
const classifierCanonicalUrl = [
  'https',
  '://www.youtube.com/watch?v=classifier'
].join('')
const classifierRejectedSourceRef = [
  'https',
  '://private.example/item?account=secret'
].join('')
const visualStageMediaUrl = [
  'https',
  '://www.youtube.com/thumbnail.png?private=tracking'
].join('')
const hostileRedditCanonicalUrl = [
  'https',
  '://reddit.com/r/private/comments/private-binding'
].join('')
const visualInputMediaUrl = [
  'https',
  '://www.youtube.com/thumbnail.png?tracking=secret'
].join('')
const forbiddenFontCssUrl = ['https', '://fonts.example.test/ui.css'].join('')
const forbiddenFontWoffUrl = ['https', '://fonts.example.test/ui.woff2'].join(
  ''
)
const readmeStableReleaseBadgeUrl = [
  'https',
  '://img.shields.io/github/v/release/everton-dgn/content-lens?label=stable'
].join('')
const readmeLicenseBadgeUrl = [
  'https',
  '://img.shields.io/github/license/everton-dgn/content-lens'
].join('')
const syncCredentialUrl = [
  'https',
  '://user:',
  'secret',
  '@sync.example/contentlens.json'
].join('')
const approvedUrlIdentifiersByPath = new Map<string, ReadonlySet<string>>([
  [
    'README.md',
    new Set([
      optionalHttpsPattern,
      optionalHttpPattern,
      readmeStableReleaseBadgeUrl,
      readmeLicenseBadgeUrl
    ])
  ],
  [
    'scripts/ci/public-guard.ts',
    new Set([
      'https://www.reddit.com.evil.test',
      'http://www.reddit.com/r/all',
      'https://feeds.example/source.xml#fragment',
      'https://feeds.example/source.xml#other',
      'https://www.youtube.com/watch?v=one&secret=ignored',
      'https://www.youtube.com/watch?v=one&feature=share',
      'https://www.youtube.com/watch?si=tracking&v=one',
      'https://www.youtube.com/watch?v=one&utm_source=test#fragment',
      'https://www.youtube.com/watch?v=one',
      'https://www.reddit.com.evil.test/r/all',
      'http://sync.example/contentlens.json',
      syncCredentialUrl
    ])
  ],
  [
    'docs/adr/0014-browser-manifest-permissions.md',
    new Set([optionalHttpsPattern, optionalHttpPattern])
  ],
  [
    'docs/security/permissions-matrix.md',
    new Set([optionalHttpsPattern, optionalHttpPattern])
  ],
  [
    'docs/store/permission-justifications.md',
    new Set([optionalHttpsPattern, optionalHttpPattern])
  ],
  ['src/ai/providers/templates.ts', new Set([ollamaLoopbackOrigin])],
  [
    'tests/browser/fixtures/sidepanel-preview.html',
    new Set([ollamaLoopbackOrigin])
  ],
  [
    'src/config/manifest.test.ts',
    new Set([optionalHttpsPattern, optionalHttpPattern])
  ],
  [
    'src/config/manifest.ts',
    new Set([optionalHttpsPattern, optionalHttpPattern])
  ],
  [
    'tests/browser/panel-open-smoke.spec.ts',
    new Set([optionalHttpsPattern, optionalHttpPattern])
  ],
  [
    'tests/contract/provider-connection.test.ts',
    new Set([
      optionalHttpsPattern,
      optionalHttpPattern,
      ollamaLoopbackOrigin,
      `${ollamaLoopbackOrigin}/*`,
      remoteHttpExample
    ])
  ],
  [
    'tests/contract/classifier.test.ts',
    new Set([classifierCanonicalUrl, classifierRejectedSourceRef])
  ],
  [
    'tests/contract/browser-content-script-activation.test.ts',
    new Set([optionalHttpsPattern])
  ],
  [
    'tests/contract/installed-adapter-origins.test.ts',
    new Set(['https://www.reddit.com.evil.test', 'http://www.reddit.com/r/all'])
  ],
  [
    'tests/contract/provider-catalog-refresh.test.ts',
    new Set([ollamaLoopbackOrigin])
  ],
  [
    'tests/contract/rss-subscriptions.test.ts',
    new Set([
      'https://feeds.example/source.xml#fragment',
      'https://feeds.example/source.xml#other'
    ])
  ],
  [
    'tests/contract/similarity-runtime.test.ts',
    new Set(['https://www.youtube.com/watch?v=one&secret=ignored'])
  ],
  [
    'tests/contract/similarity.test.ts',
    new Set([
      'https://www.youtube.com/watch?v=one&feature=share',
      'https://www.youtube.com/watch?si=tracking&v=one',
      'https://www.youtube.com/watch?v=one&utm_source=test#fragment',
      'https://www.youtube.com/watch?v=one'
    ])
  ],
  ['tests/runtime/routed-assistance.test.ts', new Set([ollamaLoopbackOrigin])],
  ['tests/runtime/routed-text-stage.test.ts', new Set([ollamaLoopbackOrigin])],
  [
    'tests/runtime/visual-stage.test.ts',
    new Set([ollamaLoopbackOrigin, visualStageMediaUrl])
  ],
  [
    'tests/security/text-classification.test.ts',
    new Set([hostileRedditCanonicalUrl])
  ],
  ['tests/security/visual-input.test.ts', new Set([visualInputMediaUrl])],
  [
    'tests/security/adapter-runtime-control.test.ts',
    new Set(['https://www.reddit.com.evil.test/r/all'])
  ],
  [
    'tests/sync/conditional-http-provider.test.ts',
    new Set(['http://sync.example/contentlens.json', syncCredentialUrl])
  ],
  [
    'tests/unit/design-system-rules.test.ts',
    new Set([forbiddenFontCssUrl, forbiddenFontWoffUrl])
  ]
])
const approvedNetworkClientPaths = new Set([
  'src/ai/providers/request-policy.ts',
  'src/sync/providers/conditional-http.ts'
])
const rssNetworkForbiddenPaths = [
  'src/adapters/rss/',
  'src/application/feed-subscriptions/',
  'src/extension/service-worker/rss-runtime.ts'
] as const
const rssNetworkCapabilityNames = new Set([
  'EventSource',
  'WebSocket',
  'XMLHttpRequest',
  'fetch',
  'sendBeacon'
])
const rssNetworkBoundarySuffixes = [
  '/ai/providers/request-policy',
  '/sync/providers/conditional-http'
] as const
const approvedPrivateNetworkReferencePaths = new Set([
  'src/adapters/rss/routes.ts',
  'src/ai/providers/contracts.ts',
  'tests/contract/adapter-routes.test.ts',
  'tests/contract/rss-hostname-policy.test.ts'
])
const approvedPrivateNetworkReferencesByPath = new Map<
  string,
  ReadonlySet<string>
>([
  ['README.md', new Set([['local', 'host'].join('')])],
  ['src/ai/providers/templates.ts', new Set([['127', '.0.0.1'].join('')])],
  [
    'tests/contract/provider-connection.test.ts',
    new Set([['127', '.0.0.1'].join('')])
  ],
  [
    'tests/runtime/routed-assistance.test.ts',
    new Set([['127', '.0.0.1'].join('')])
  ],
  [
    'tests/runtime/routed-text-stage.test.ts',
    new Set([['127', '.0.0.1'].join('')])
  ],
  ['tests/runtime/visual-stage.test.ts', new Set([['127', '.0.0.1'].join('')])],
  [
    'src/sync/providers/conditional-http.ts',
    new Set([['127', '.0.0.1'].join(''), ['local', 'host'].join('')])
  ],
  [
    'tests/browser/fixtures/sidepanel-preview.html',
    new Set([['127', '.0.0.1'].join('')])
  ],
  [
    'tests/contract/provider-catalog-refresh.test.ts',
    new Set([['127', '.0.0.1'].join('')])
  ]
])

const approvedFindingLinesByPath = new Map<
  string,
  ReadonlyMap<string, ReadonlySet<number>>
>([
  [
    'src/ai/providers/request-policy.ts',
    new Map([['literal-secret-assignment', new Set([173])]])
  ],
  [
    'tests/contract/settings-runtime.test.ts',
    new Map([['literal-secret-assignment', new Set([71])]])
  ],
  [
    'tests/sync/conditional-http-provider.test.ts',
    new Map([['personal-email', new Set([178])]])
  ],
  [
    'tests/sync/conflict-resolution.test.ts',
    new Map([['literal-secret-assignment', new Set([100])]])
  ]
])

const sensitiveExtensions = new Set(['.crt', '.key', '.p12', '.pem', '.pfx'])
const mediaExtensions = new Set([
  '.gif',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.png',
  '.webm',
  '.webp'
])
const archiveExtension = '.zip'
const sensitiveBasenames = new Set([
  '.netrc',
  '.npmrc',
  'credentials.json',
  'id_ed25519',
  'id_rsa',
  'secrets.json'
])
const maximumArchiveEntries = 500
const maximumArchiveEntryBytes = 5 * 1024 * 1024

const lineAt = (content: string, index: number): number =>
  content.slice(0, index).split('\n').length

const finding = (
  path: string,
  code: string,
  content = '',
  index = 0
): GuardFinding => ({
  code,
  line: content ? lineAt(content, index) : 1,
  path
})

const normalizePath = (path: string): string => path.split(sep).join('/')

const isEnvironmentFile = (path: string): boolean => {
  const basename = normalizePath(path).split('/').at(-1) ?? ''
  return basename.startsWith('.env') && basename !== '.env.example'
}

const isSensitivePath = (path: string): boolean => {
  const normalized = normalizePath(path).toLowerCase()
  const rooted = `/${normalized}`
  const basename = normalized.split('/').at(-1) ?? ''
  return (
    sensitiveExtensions.has(extname(basename)) ||
    sensitiveBasenames.has(basename) ||
    /^service_account.*\.json$/u.test(basename) ||
    rooted.endsWith('/.aws/credentials') ||
    rooted.endsWith('/.kube/config') ||
    rooted.endsWith('/.ssh/config')
  )
}

const isRestrictedEvidencePath = (path: string): boolean => {
  const normalized = `/${normalizePath(path).toLowerCase()}`
  return (
    normalized.includes('/diagnostics/') ||
    normalized.includes('/exports/') ||
    normalized.includes('/fixtures/') ||
    normalized.endsWith('.diagnostic.json') ||
    normalized.endsWith('.export.json')
  )
}

const isDiagnosticOrExportPath = (path: string): boolean => {
  const normalized = `/${normalizePath(path).toLowerCase()}`
  return (
    normalized.includes('/diagnostics/') ||
    normalized.includes('/exports/') ||
    normalized.endsWith('.diagnostic.json') ||
    normalized.endsWith('.export.json')
  )
}

const isFixturePath = (path: string): boolean =>
  `/${normalizePath(path).toLowerCase()}`.includes('/fixtures/')

const isAllowedPublicUrl = (rawUrl: string, path = ''): boolean => {
  if (
    allowedUrlIdentifiers.has(rawUrl) ||
    approvedUrlIdentifiersByPath.get(path)?.has(rawUrl) ||
    /^http:\/\/\[\$\{[A-Za-z][A-Za-z0-9._]*\}\]$/u.test(rawUrl)
  ) {
    return true
  }

  try {
    const parsed = new URL(rawUrl)
    const hostname = parsed.hostname.toLowerCase()
    const reservedSyntheticHost =
      hostname.endsWith('.example') || hostname.endsWith('.invalid')
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      (allowedUrlHosts.has(hostname) || reservedSyntheticHost)
    )
  } catch {
    return false
  }
}

const trimUrlPunctuation = (rawUrl: string): string =>
  rawUrl.replace(/[),.;:]+$/u, '')

export const scanPath = (path: string): GuardFinding[] => {
  return isSensitivePath(path) || isEnvironmentFile(path)
    ? [finding(normalizePath(path), 'sensitive-path')]
    : []
}

const addPatternFindings = (
  findings: GuardFinding[],
  path: string,
  content: string,
  code: string,
  pattern: RegExp
): void => {
  for (const match of content.matchAll(pattern)) {
    findings.push(finding(path, code, content, match.index))
  }
}

const addPrivateNetworkFindings = (
  findings: GuardFinding[],
  displayPath: string,
  policyPath: string,
  content: string,
  pattern: RegExp
): void => {
  const approved = approvedPrivateNetworkReferencesByPath.get(policyPath)
  for (const match of content.matchAll(pattern)) {
    const value = match[0].toLowerCase()
    if (!approved?.has(value)) {
      findings.push(
        finding(displayPath, 'private-network-reference', content, match.index)
      )
    }
  }
}

const isRssNetworkBoundary = (specifier: string): boolean => {
  const normalized = `/${specifier.replace(/^@\//u, '').replace(/\.(?:js|ts)$/u, '')}`
  return rssNetworkBoundarySuffixes.some(suffix => normalized.endsWith(suffix))
}

const findRssNetworkReference = (content: string): number | undefined => {
  const scanner = createScanner(true, undefined, content)
  const tokens: Array<{ kind: SyntaxKind; start: number; value: string }> = []
  const templateExpressionBraceDepths: number[] = []
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; ) {
    if (kind === SyntaxKind.TemplateHead) {
      templateExpressionBraceDepths.push(0)
    } else if (templateExpressionBraceDepths.length > 0) {
      const depthIndex = templateExpressionBraceDepths.length - 1
      const depth = templateExpressionBraceDepths[depthIndex] ?? 0
      if (kind === SyntaxKind.OpenBraceToken) {
        templateExpressionBraceDepths[depthIndex] = depth + 1
      } else if (kind === SyntaxKind.CloseBraceToken && depth > 0) {
        templateExpressionBraceDepths[depthIndex] = depth - 1
      } else if (kind === SyntaxKind.CloseBraceToken) {
        kind = scanner.reScanTemplateToken(false)
        if (kind === SyntaxKind.TemplateTail) {
          templateExpressionBraceDepths.pop()
        }
      }
    }
    tokens.push({
      kind,
      start: scanner.getTokenStart(),
      value: scanner.getTokenValue()
    })
    kind = scanner.scan()
  }

  for (const [index, token] of tokens.entries()) {
    if (
      token.kind === SyntaxKind.Identifier &&
      rssNetworkCapabilityNames.has(token.value)
    ) {
      return token.start
    }
    if (
      (token.kind === SyntaxKind.StringLiteral ||
        token.kind === SyntaxKind.NoSubstitutionTemplateLiteral) &&
      isRssNetworkBoundary(token.value)
    ) {
      return token.start
    }
    if (
      token.kind !== SyntaxKind.StringLiteral &&
      token.kind !== SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      continue
    }
    let combined = token.value
    let cursor = index + 1
    while (
      tokens[cursor]?.kind === SyntaxKind.PlusToken &&
      (tokens[cursor + 1]?.kind === SyntaxKind.StringLiteral ||
        tokens[cursor + 1]?.kind === SyntaxKind.NoSubstitutionTemplateLiteral)
    ) {
      combined += tokens[cursor + 1]?.value ?? ''
      cursor += 2
    }
    if (rssNetworkCapabilityNames.has(combined)) {
      return token.start
    }
  }
  return undefined
}

export const scanText = (path: string, content: string): GuardFinding[] => {
  const findings: GuardFinding[] = []
  const normalizedPath = normalizePath(path)
  const worktreePath = normalizedPath.replace(/ \(staged\)$/u, '')
  const policyPath = worktreePath.includes('!/')
    ? (worktreePath.split('!/').at(-1) ?? worktreePath)
    : worktreePath
  const containsNetworkClient =
    /\b(?:EventSource|WebSocket|XMLHttpRequest|fetch)\s*\(|navigator\.sendBeacon\s*\(/u.test(
      content
    )
  const rssNetworkReferenceIndex = rssNetworkForbiddenPaths.some(prefix =>
    policyPath.startsWith(prefix)
  )
    ? findRssNetworkReference(content)
    : undefined

  addPatternFindings(
    findings,
    normalizedPath,
    content,
    'private-key-material',
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/gu
  )
  addPatternFindings(
    findings,
    normalizedPath,
    content,
    'provider-credential',
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu
  )
  addPatternFindings(
    findings,
    normalizedPath,
    content,
    'literal-secret-assignment',
    /["']?\b(?:api(?:[_-]?key|Key)|authorization|password|secret|token)\b["']?\s*[:=]\s*["'][^"' \r\n]{8,}["']/giu
  )
  addPatternFindings(
    findings,
    normalizedPath,
    content,
    'literal-secret-assignment',
    /["']?\b(?:api(?:[_-]?key|Key)|authorization|password|secret|token)\b["']?\s*:\s*[A-Za-z0-9_./+=-]{16,}\b/giu
  )
  addPatternFindings(
    findings,
    normalizedPath,
    content,
    'local-absolute-path',
    /(?:\/Users\/[^/\s"'`]+\/|\/home\/[^/\s"'`]+\/|[A-Za-z]:\\Users\\[^\\\s"'`]+\\)/gu
  )
  if (!approvedPrivateNetworkReferencePaths.has(policyPath)) {
    addPrivateNetworkFindings(
      findings,
      worktreePath,
      policyPath,
      content,
      /\b(?:local(?:host)|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/giu
    )
    addPrivateNetworkFindings(
      findings,
      worktreePath,
      policyPath,
      content,
      /(?:^|[^0-9A-F:])(?::{2}1|f[cd][0-9A-F]{0,2}(?::[0-9A-F]{0,4}){1,7}|fe[89ab][0-9A-F](?::[0-9A-F]{0,4}){1,7})(?![0-9A-F:])/gimu
    )
  }
  addPatternFindings(
    findings,
    normalizedPath,
    content,
    'personal-email',
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
  )

  const urlPattern = /https?:\/\/(?:(?!\]\()[^\s<>"'`])+/gu
  for (const match of content.matchAll(urlPattern)) {
    const rawUrl = trimUrlPunctuation(match[0])
    if (
      !isAllowedPublicUrl(rawUrl, policyPath) ||
      (isDiagnosticOrExportPath(normalizedPath) &&
        !normalizedPath.endsWith('.fixture.json'))
    ) {
      findings.push(
        finding(normalizedPath, 'unapproved-public-url', content, match.index)
      )
    }
  }

  if (isDiagnosticOrExportPath(normalizedPath)) {
    addPatternFindings(
      findings,
      normalizedPath,
      content,
      'prohibited-diagnostic-field',
      /["'](?:accountId|authorization|contentBody|contentTitle|cookie|dom|email|html|media|profile|prompt|query|transcript|url)["']\s*:/giu
    )
  }

  if (isRestrictedEvidencePath(normalizedPath)) {
    addPatternFindings(
      findings,
      normalizedPath,
      content,
      'private-domain-reference',
      /\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:corp|internal|local)\b/giu
    )
  }

  if (rssNetworkReferenceIndex !== undefined) {
    findings.push(
      finding(
        normalizedPath,
        'rss-network-acquisition-forbidden',
        content,
        rssNetworkReferenceIndex
      )
    )
  }

  if (
    policyPath.startsWith('src/') &&
    !approvedNetworkClientPaths.has(policyPath) &&
    containsNetworkClient
  ) {
    findings.push(finding(normalizedPath, 'unapproved-network-client'))
  }

  if (
    isRestrictedEvidencePath(normalizedPath) &&
    /<!doctype\s+html|<html[\s>]/iu.test(content) &&
    !isFixturePath(normalizedPath)
  ) {
    findings.push(finding(normalizedPath, 'raw-dom-evidence'))
  }

  const approved = approvedFindingLinesByPath.get(policyPath)
  return findings.filter(item => !approved?.get(item.code)?.has(item.line))
}

export const validateFixtureMetadata = (
  path: string,
  metadata: unknown
): GuardFinding[] => {
  const findings: GuardFinding[] = []
  const value = metadata as FixtureMetadata | null
  const sourceKind = value?.source?.kind

  if (value?.schemaVersion !== 1) {
    findings.push(finding(path, 'fixture-schema-version'))
  }
  if (typeof value?.surface !== 'string' || value.surface.trim() === '') {
    findings.push(finding(path, 'fixture-surface'))
  }
  if (typeof value?.license !== 'string' || value.license.trim() === '') {
    findings.push(finding(path, 'fixture-license'))
  }
  if (sourceKind !== 'synthetic' && sourceKind !== 'redistributable') {
    findings.push(finding(path, 'fixture-source-kind'))
  }
  if (sourceKind === 'synthetic' && value?.synthetic !== true) {
    findings.push(finding(path, 'fixture-synthetic-assertion'))
  }
  if (
    sourceKind === 'redistributable' &&
    (typeof value?.source?.url !== 'string' ||
      !isAllowedPublicUrl(value.source.url))
  ) {
    findings.push(finding(path, 'fixture-source-url'))
  }

  return findings
}

const runGit = (root: string, args: string[]): Buffer => {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024
  })
  if (result.status !== 0) {
    throw new Error(
      'Unable to enumerate repository files for the public guard.'
    )
  }
  return result.stdout
}

const parseNullSeparated = (output: Buffer): string[] =>
  output.toString('utf8').split('\0').filter(Boolean)

export const collectRepositoryPaths = (root: string): string[] => {
  const workspacePaths = parseNullSeparated(
    runGit(root, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z'
    ])
  )
  const stagedPaths = parseNullSeparated(
    runGit(root, [
      'diff',
      '--cached',
      '--name-only',
      '--diff-filter=ACMR',
      '-z'
    ])
  )

  return [...new Set([...workspacePaths, ...stagedPaths])].sort()
}

const collectStagedPaths = (root: string): string[] =>
  parseNullSeparated(
    runGit(root, [
      'diff',
      '--cached',
      '--name-only',
      '--diff-filter=ACMR',
      '-z'
    ])
  ).sort()

const fixtureMetadataPath = (path: string): string =>
  path.replace(/\.[^./]+$/u, '.fixture.json')

const scanFixture = async (
  root: string,
  path: string
): Promise<GuardFinding[]> => {
  if (!isFixturePath(path)) {
    return []
  }

  const extension = extname(path).toLowerCase()
  if (extension !== '.html' && !mediaExtensions.has(extension)) {
    return []
  }

  const metadataPath = fixtureMetadataPath(path)
  try {
    const metadata = JSON.parse(
      await readFile(resolve(root, metadataPath), 'utf8')
    ) as unknown
    return validateFixtureMetadata(metadataPath, metadata)
  } catch {
    return [finding(metadataPath, 'fixture-metadata-missing-or-invalid')]
  }
}

const archiveEntryIsUnsafe = (entry: string): boolean =>
  entry.startsWith('/') ||
  entry.startsWith('\\') ||
  entry.split(/[\\/]/u).includes('..')

export const scanArchiveContents = (
  path: string,
  reader: ArchiveReader
): GuardFinding[] => {
  const findings: GuardFinding[] = []
  const entries = reader.list()
  if (!entries) {
    return [finding(path, 'archive-unreadable')]
  }

  if (entries.length > maximumArchiveEntries) {
    findings.push(finding(path, 'archive-entry-limit'))
    return findings
  }

  for (const entry of entries) {
    const virtualPath = `${path}!/${entry}`
    if (archiveEntryIsUnsafe(entry)) {
      findings.push(finding(virtualPath, 'archive-path-traversal'))
      continue
    }

    if (isSensitivePath(entry) || isEnvironmentFile(entry)) {
      findings.push(finding(virtualPath, 'sensitive-path'))
      continue
    }

    const entryContent = reader.read(entry)
    if (!entryContent) {
      findings.push(finding(virtualPath, 'archive-entry-unreadable'))
      continue
    }

    if (!entryContent.includes(0)) {
      findings.push(...scanText(virtualPath, entryContent.toString('utf8')))
    }
  }

  return findings
}

const scanArchive = (root: string, path: string): GuardFinding[] => {
  const archivePath = resolve(root, path)
  return scanArchiveContents(path, {
    list: () => {
      const result = spawnSync('unzip', ['-Z1', archivePath], {
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024
      })
      return result.status === 0
        ? result.stdout.split('\n').filter(Boolean)
        : null
    },
    read: entry => {
      const result = spawnSync('unzip', ['-p', archivePath, entry], {
        encoding: 'buffer',
        maxBuffer: maximumArchiveEntryBytes
      })
      return result.status === 0 ? result.stdout : null
    }
  })
}

const resolveCandidatePath = (root: string, candidate: string): string => {
  const absolute = resolve(root, candidate)
  const repositoryRelative = normalizePath(relative(root, absolute))
  if (
    isAbsolute(repositoryRelative) ||
    repositoryRelative === '..' ||
    repositoryRelative.startsWith('../')
  ) {
    throw new Error(`Guard path escapes the repository: ${candidate}`)
  }
  return repositoryRelative
}

export const runPublicGuard = async (
  root: string,
  requestedPaths: readonly string[] = []
): Promise<GuardFinding[]> => {
  const hasRequestedPaths = requestedPaths.length > 0
  const paths = (
    hasRequestedPaths
      ? requestedPaths.map(path => resolveCandidatePath(root, path))
      : collectRepositoryPaths(root)
  ).sort()
  const findings: GuardFinding[] = []

  for (const path of paths) {
    const extension = extname(path).toLowerCase()
    const pathFindings = scanPath(path)
    if (pathFindings.length > 0) {
      findings.push(...pathFindings)
      continue
    }

    let fileStats: Awaited<ReturnType<typeof lstat>>
    try {
      fileStats = await lstat(resolve(root, path))
    } catch {
      if (hasRequestedPaths) {
        findings.push(finding(path, 'requested-path-missing'))
      }
      continue
    }
    if (fileStats.isSymbolicLink()) {
      findings.push(finding(path, 'symbolic-link'))
      continue
    }
    if (!fileStats.isFile()) {
      continue
    }

    if (extension === archiveExtension) {
      findings.push(...scanArchive(root, path))
      continue
    }

    findings.push(...(await scanFixture(root, path)))
    const content = await readFile(resolve(root, path))
    if (!content.includes(0)) {
      findings.push(...scanText(path, content.toString('utf8')))
    } else if (isRestrictedEvidencePath(path) && !isFixturePath(path)) {
      findings.push(finding(path, 'raw-media-evidence'))
    }
  }

  if (!hasRequestedPaths) {
    for (const path of collectStagedPaths(root)) {
      const stagedResult = spawnSync('git', ['show', `:${path}`], {
        cwd: root,
        encoding: 'buffer',
        maxBuffer: maximumArchiveEntryBytes
      })
      if (stagedResult.status !== 0) {
        findings.push(finding(`${path} (staged)`, 'staged-content-unreadable'))
        continue
      }

      const stagedContent = stagedResult.stdout
      const extension = extname(path).toLowerCase()
      const worktreeContent = await readFile(resolve(root, path)).catch(() =>
        Buffer.alloc(0)
      )
      if (stagedContent.equals(worktreeContent)) {
        continue
      }

      if (extension === archiveExtension) {
        findings.push(
          finding(`${path} (staged)`, 'staged-archive-worktree-mismatch')
        )
      } else if (!stagedContent.includes(0)) {
        findings.push(
          ...scanText(`${path} (staged)`, stagedContent.toString('utf8'))
        )
      } else if (isRestrictedEvidencePath(path) && !isFixturePath(path)) {
        findings.push(finding(`${path} (staged)`, 'raw-media-evidence'))
      }
    }
  }

  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.code.localeCompare(right.code)
  )
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  const requestedPaths = process.argv
    .slice(2)
    .filter(argument => argument !== '--')
  const findings = await runPublicGuard(process.cwd(), requestedPaths)
  if (findings.length > 0) {
    for (const item of findings) {
      console.error(`${item.path}:${item.line} ${item.code}`)
    }
    process.exitCode = 1
  } else {
    console.log('Public repository guard passed.')
  }
}
