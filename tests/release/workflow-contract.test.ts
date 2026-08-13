import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflow = (name: string) =>
  readFile(resolve('.github/workflows', name), 'utf8')
const releaseScript = (name: string) =>
  readFile(resolve('scripts/release', name), 'utf8')

describe('release workflow contracts', () => {
  it('applies the bundle limit to both release outputs', async () => {
    const source = await releaseScript('package.mjs')
    expect(source).toContain('guardBundleDirectory')
    expect(source).toContain("['chrome-mv3', 'firefox-mv2']")
  })

  it('publishes one candidate, compares a rebuild and verifies independently', async () => {
    const source = await workflow('release-candidate.yml')
    expect(source).toContain('pnpm release:package')
    expect(source.match(/pnpm release:package/gu)).toHaveLength(2)
    expect(source).toContain('Compare independent rebuild')
    expect(source).toContain('cmp \\')
    expect(source).toContain('actions/attest@')
    expect(source).toContain('id-token: write')
    expect(source).toContain('attestations: write')
    expect(source).toContain('pnpm release:verify')
    expect(source).toContain('--require-attestation')
    expect(source).not.toContain('pull_request_target')
  })

  it('uses protected, separate store environments and never rebuilds', async () => {
    const source = await workflow('publish-extension.yml')
    expect(source).toContain('environment: chrome-web-store')
    expect(source).toContain('environment: amo')
    expect(source).toContain('pnpm release:status -- --store chrome')
    expect(source).toContain('pnpm release:status -- --store amo')
    expect(source).toContain('gh attestation verify')
    expect(source).not.toMatch(/\bwxt (?:build|zip)\b/u)
    expect(source).not.toContain('--chrome-cancel-pending')
  })

  it('audits egress before store credentials enter either publishing job', async () => {
    const source = await workflow('publish-extension.yml')
    const chromeJob = source.slice(
      source.indexOf('  chrome:'),
      source.indexOf('  amo:')
    )
    const amoJob = source.slice(source.indexOf('  amo:'))
    const hardenRunner =
      'step-security/harden-runner@b09bb98e06d4d774595224525879c09bc6e98c40'

    expect(source.match(/step-security\/harden-runner@/gu)).toHaveLength(2)
    for (const job of [chromeJob, amoJob]) {
      expect(job).toContain(hardenRunner)
      expect(job).toContain('egress-policy: audit')
      expect(job.indexOf(hardenRunner)).toBeLessThan(
        job.indexOf('actions/checkout@')
      )
    }
  })

  it.each(['release-candidate.yml', 'publish-extension.yml'])(
    'pins every action in %s',
    async name => {
      const source = await workflow(name)
      const references = [...source.matchAll(/uses:\s+\S+@(\S+)/gu)]
      expect(references.length).toBeGreaterThan(0)
      for (const reference of references)
        expect(reference[1]).toMatch(/^[0-9a-f]{40}$/u)
    }
  )
})
