import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_CHUNK_LIMIT_BYTES,
  findOversizedChunks
} from '../../scripts/ci/bundle-size-guard'
import { createProvenance } from '../../scripts/release/create-provenance.mjs'
import {
  createSbom,
  flattenDependencies
} from '../../scripts/release/generate-sbom.mjs'
import { findUnreviewedNetworkLiterals } from '../../scripts/release/guard-artifact.mjs'
import { artifactNames, validateVersion } from '../../scripts/release/lib.mjs'
import { decideStoreStatus } from '../../scripts/release/store-status.mjs'
import { submitChromePackage } from '../../scripts/release/submit-chrome.mjs'

describe('release evidence contracts', () => {
  it('rejects JavaScript chunks above the production bundle limit', () => {
    const chunks = [
      { bytes: DEFAULT_CHUNK_LIMIT_BYTES, path: 'chunks/accepted.js' },
      { bytes: DEFAULT_CHUNK_LIMIT_BYTES + 1, path: 'chunks/oversized.js' }
    ]

    expect(findOversizedChunks(chunks)).toEqual([chunks[1]])
  })

  it('ignores CSS metadata URLs while retaining executable network literals', () => {
    const metadataUrl = ['https:', '//tailwindcss.com'].join('')
    const executableUrl = ['https:', '//cdn.example.com/image.png'].join('')
    const css = [
      `/*! tailwindcss | MIT License | ${metadataUrl} */`,
      `.remote { background: url("${executableUrl}"); }`
    ].join('\n')

    expect(findUnreviewedNetworkLiterals('bundle.css', css)).toEqual([
      executableUrl
    ])
  })

  it('uses the three exact package names', () => {
    expect(artifactNames('1.2.3')).toEqual([
      'content-lens-1.2.3-chrome.zip',
      'content-lens-1.2.3-firefox.zip',
      'content-lens-1.2.3-sources.zip'
    ])
    expect(() => validateVersion('1.2')).toThrow('Invalid package version')
    expect(() => validateVersion('1.2.3-rc.1')).toThrow(
      'Invalid package version'
    )
    expect(() => validateVersion('01.2.3')).toThrow('Invalid package version')
  })

  it('deduplicates the production dependency graph into SPDX packages', () => {
    const dependencies = flattenDependencies({
      react: {
        version: '19.2.8',
        dependencies: { scheduler: { version: '0.27.0' } }
      },
      scheduler: { version: '0.27.0' }
    })
    expect(dependencies).toEqual([
      { name: 'react', version: '19.2.8' },
      { name: 'scheduler', version: '0.27.0' }
    ])
    const sbom = createSbom({
      product: { name: 'content-lens', version: '1.2.3', license: 'MIT' },
      dependencies,
      commit: 'a'.repeat(40)
    })
    expect(sbom.spdxVersion).toBe('SPDX-2.3')
    expect(sbom.packages).toHaveLength(3)
    expect(sbom.relationships).toHaveLength(2)
  })

  it('binds every package digest to an in-toto SLSA v1 subject', () => {
    const manifest = {
      channel: 'stable',
      source: { commit: 'a'.repeat(40), tag: 'v1.2.3' },
      toolchain: { node: 'v24' },
      inputs: { lockfile: { sha256: 'b'.repeat(64) } },
      artifacts: [
        { name: 'content-lens-1.2.3-chrome.zip', sha256: 'c'.repeat(64) },
        { name: 'content-lens-1.2.3-firefox.zip', sha256: 'd'.repeat(64) },
        { name: 'content-lens-1.2.3-sources.zip', sha256: 'e'.repeat(64) }
      ]
    }
    const provenance = createProvenance({
      manifest,
      github: {
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_WORKFLOW_REF:
          'owner/repo/.github/workflows/release.yml@refs/tags/v1.2.3',
        GITHUB_RUN_ID: '42'
      }
    })
    expect(provenance._type).toBe('https://in-toto.io/Statement/v1')
    expect(provenance.predicateType).toBe('https://slsa.dev/provenance/v1')
    expect(provenance.subject).toEqual(
      manifest.artifacts.map(({ name, sha256 }) => ({
        name,
        digest: { sha256 }
      }))
    )
  })

  it.each([
    [
      { item: { submittedVersion: '1.2.3', status: 'PENDING_REVIEW' } },
      'already-present'
    ],
    [
      { results: [{ version: '1.2.2', file: { status: 'public' } }] },
      'eligible'
    ],
    [
      {
        item: {
          version: '1.2.2',
          status: 'REJECTED',
          rejectionReason: 'policy'
        }
      },
      'blocked'
    ]
  ] as const)('classifies a read-only store response', (response, decision) => {
    expect(
      decideStoreStatus({ store: 'chrome', version: '1.2.3', response })
        .decision
    ).toBe(decision)
  })

  it('submits the verified Chrome ZIP with a short-lived access token', async () => {
    const responses = [
      { itemState: 'OK' },
      { uploadState: 'SUCCEEDED' },
      { submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } }
    ]
    const fetchImpl = vi.fn(
      async (_url: string | URL, _options?: RequestInit) =>
        new Response(JSON.stringify(responses.shift()), {
          headers: { 'content-type': 'application/json' },
          status: 200
        })
    )

    await expect(
      submitChromePackage({
        publisherId: 'publisher-id',
        extensionId: 'extension-id',
        zipPath: resolve('tests/fixtures/profiles/rule-conflict.json'),
        accessToken: 'short-lived-token',
        fetchImpl
      })
    ).resolves.toEqual({
      extensionId: 'extension-id',
      publisherId: 'publisher-id',
      publishType: 'STAGED_PUBLISH',
      status: 'submitted'
    })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://chromewebstore.googleapis.com/v2/publishers/publisher-id/items/extension-id:fetchStatus',
      'https://chromewebstore.googleapis.com/upload/v2/publishers/publisher-id/items/extension-id:upload',
      'https://chromewebstore.googleapis.com/v2/publishers/publisher-id/items/extension-id:publish'
    ])
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: 'Bearer short-lived-token',
      'x-goog-api-version': '2'
    })
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body))).toEqual({
      blockOnWarnings: true,
      publishType: 'STAGED_PUBLISH'
    })
  })

  it('keeps the release-manifest schema strict and versioned', async () => {
    const schema = JSON.parse(
      await readFile(
        resolve('docs/schemas/release-manifest.schema.json'),
        'utf8'
      )
    )
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.schemaVersion.const).toBe(1)
    expect(schema.properties.artifacts.minItems).toBe(3)
    expect(schema.properties.artifacts.maxItems).toBe(3)
  })
})
