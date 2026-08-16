import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflow = (name: string) =>
  readFile(resolve('.github/workflows', name), 'utf8')
const releaseScript = (name: string) =>
  readFile(resolve('scripts/release', name), 'utf8')

describe('release workflow contracts', () => {
  it('creates and publishes only stable releases after verified main CI', async () => {
    const source = await workflow('auto-release.yml')
    const script = await releaseScript('automatic-release.ts')

    expect(source).toContain('workflow_run:')
    expect(source).toContain('- CI')
    expect(source).toContain("github.event.workflow_run.event == 'push'")
    expect(source).toContain(
      "github.event.workflow_run.event == 'workflow_dispatch'"
    )
    expect(source).toContain(
      "github.event.workflow_run.actor.login == 'github-actions[bot]'"
    )
    expect(source).toContain(
      "github.event.workflow_run.conclusion == 'success'"
    )
    expect(source).toContain("github.event.workflow_run.head_branch == 'main'")
    expect(source).toContain('node scripts/release/automatic-release.ts')
    expect(source).toContain('ref: main')
    expect(source).not.toMatch(
      /ref:\s*\$\{\{[^\n]*client_payload\.source_sha/iu
    )
    expect(source).not.toContain('repository_dispatch:')
    expect(script).toMatch(/'checkout',\s*'--detach',\s*context\.sourceSha/u)
    expect(script).toContain('targetSha: release.releaseSha')
    expect(script).toContain('findOldestIncompleteStableRelease')
    expect(script).not.toContain('waitForSuccessfulBaseCi')
    expect(source).toContain('pnpm release:package -- --channel stable')
    expect(source).toContain('gh release create')
    expect(source).toContain('gh release delete-asset')
    const publishStep = source.slice(
      source.indexOf('- name: Create or repair the stable GitHub Release'),
      source.indexOf('  continuation:')
    )
    expect(publishStep).toContain('set -euo pipefail')
    for (const contract of [source, script]) {
      expect(contract).not.toMatch(/\b(?:alpha|beta)\b|release.?candidate/iu)
      expect(contract).not.toContain('pull_request_target')
    }
    expect(source).toContain('workflow_dispatch:')
    expect(source).toContain('gh workflow run auto-release.yml \\')
    expect(source).not.toContain('gh workflow run ci.yml')
    expect(source).toContain('source_run_id="$SOURCE_RUN_ID"')
    expect(source).toContain('source_sha="$SOURCE_SHA"')
    expect(source).toContain('test "$next_continuation_count" -le 3')
    expect(source).toContain('inputs.continuation_count < 3')
    expect(source).toContain("github.actor == 'github-actions[bot]'")
    expect(source).not.toContain('pnpm ci:local')
    expect(source).toContain("needs.version.outputs.publish == 'false'")
    expect(source).toContain("needs.publish.result == 'success'")
    expect(source).toContain("needs.publish.result != 'success'")
  })

  it('applies the bundle limit to both release outputs', async () => {
    const source = await releaseScript('package.mjs')
    expect(source).toContain('guardBundleDirectory')
    expect(source).toContain("['chrome-mv3', 'firefox-mv2']")
  })

  it('publishes one stable build, compares a rebuild and verifies independently', async () => {
    const source = await workflow('auto-release.yml')
    const reproducibilityJob = source.slice(
      source.indexOf('  reproducibility:'),
      source.indexOf('  verify:')
    )
    const rebuildStep = reproducibilityJob.indexOf(
      '- name: Rebuild stable release in a separate job'
    )
    const downloadStep = reproducibilityJob.indexOf(
      '- name: Download stable release by exact name'
    )
    const compareStep = reproducibilityJob.indexOf(
      '- name: Compare exact distributable bytes'
    )

    expect(source.match(/actions\/setup-node@/gu)).toHaveLength(5)
    expect(source).toContain('pnpm release:package')
    expect(source.match(/pnpm release:package/gu)).toHaveLength(2)
    expect(source).toContain('Compare independent stable rebuild')
    expect(rebuildStep).toBeGreaterThan(-1)
    expect(downloadStep).toBeGreaterThan(-1)
    expect(compareStep).toBeGreaterThan(-1)
    expect(rebuildStep).toBeLessThan(downloadStep)
    expect(downloadStep).toBeLessThan(compareStep)
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
    const automaticRelease = await workflow('auto-release.yml')
    const chromeJob = source.slice(
      source.indexOf('  chrome:'),
      source.indexOf('  amo:')
    )
    const amoJob = source.slice(source.indexOf('  amo:'))
    expect(source).toContain('workflow_call:')
    expect(source).toContain('environment: chrome-web-store')
    expect(source).toContain('environment: amo')
    expect(source).toContain('pnpm release:status -- --store chrome')
    expect(source).toContain('pnpm release:status -- --store amo')
    expect(source).toContain('gh attestation verify')
    expect(source).toContain('gh release download "v$RELEASE_VERSION"')
    expect(source).not.toContain('release_run_id')
    expect(source).not.toContain('run-id:')
    expect(source).not.toMatch(/\bwxt (?:build|zip)\b/u)
    expect(source).not.toContain('--chrome-cancel-pending')
    expect(source).toContain('google-github-actions/auth@')
    expect(source).toContain('id-token: write')
    expect(source).toContain(`\${{ vars.CWS_WORKLOAD_IDENTITY_PROVIDER }}`)
    expect(source).toContain(`\${{ vars.CWS_SERVICE_ACCOUNT_EMAIL }}`)
    expect(source).toContain(`\${{ steps.google-auth.outputs.access_token }}`)
    expect(source).toContain('pnpm release:submit:chrome')
    expect(source).toContain('Submit Chrome package for automatic publication')
    expect(source).not.toContain('Submit staged Chrome package')
    expect(source).not.toContain('CWS_SERVICE_ACCOUNT_PRIVATE_KEY')
    expect(automaticRelease).toContain(
      'uses: ./.github/workflows/publish-extension.yml'
    )
    expect(automaticRelease).toContain(
      "vars.CHROME_STORE_PUBLISHING_ENABLED == 'true'"
    )
    expect(automaticRelease).toContain(
      "vars.FIREFOX_STORE_PUBLISHING_ENABLED == 'true'"
    )
    expect(automaticRelease).not.toContain(
      "vars.STORE_PUBLISHING_ENABLED == 'true'"
    )
    expect(chromeJob).toContain(
      "if: vars.CHROME_STORE_PUBLISHING_ENABLED == 'true'"
    )
    expect(chromeJob).not.toContain('FIREFOX_STORE_PUBLISHING_ENABLED')
    expect(amoJob).toContain(
      "if: vars.FIREFOX_STORE_PUBLISHING_ENABLED == 'true'"
    )
    expect(amoJob).not.toContain('CHROME_STORE_PUBLISHING_ENABLED')
    expect(automaticRelease).toContain(
      `version: \${{ needs.version.outputs.version }}`
    )
    expect(automaticRelease).not.toContain('secrets: inherit')
  })

  it('installs locked dependencies before verifying store release assets', async () => {
    const source = await workflow('publish-extension.yml')
    const verifyJob = source.slice(
      source.indexOf('  verify:'),
      source.indexOf('  chrome:')
    )
    const setupPnpm = verifyJob.indexOf('- name: Set up pnpm')
    const installDependencies = verifyJob.indexOf(
      'run: pnpm install --frozen-lockfile'
    )
    const verifyRelease = verifyJob.indexOf(
      'node scripts/release/verify-provenance.mjs'
    )

    expect(verifyJob).toContain(
      'uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86'
    )
    expect(verifyJob).toContain('cache: pnpm')
    expect(verifyJob).toContain('cache-dependency-path: pnpm-lock.yaml')
    expect(setupPnpm).toBeGreaterThan(-1)
    expect(installDependencies).toBeGreaterThan(setupPnpm)
    expect(verifyRelease).toBeGreaterThan(installDependencies)
  })

  it('grants the reusable store workflow only its required permissions', async () => {
    const source = await workflow('auto-release.yml')
    const storesJob = source.slice(
      source.indexOf('  stores:'),
      source.indexOf('  continuation:')
    )

    expect(storesJob).toContain('permissions:')
    expect(storesJob).toContain('attestations: read')
    expect(storesJob).toContain('contents: read')
    expect(storesJob).toContain('id-token: write')
    expect(storesJob).not.toContain('attestations: write')
    expect(storesJob).not.toContain('contents: write')
  })

  it('validates every store decision before it reaches the job output', async () => {
    const source = await workflow('publish-extension.yml')
    const chromeJob = source.slice(
      source.indexOf('  chrome:'),
      source.indexOf('  amo:')
    )
    const amoJob = source.slice(source.indexOf('  amo:'))

    for (const job of [chromeJob, amoJob]) {
      expect(job).toContain('set -euo pipefail')
      expect(job).toContain('decision="$(jq')
      expect(job).toContain("jq -r '.decision' store-status.json")
      expect(job).toContain('already-present|blocked|eligible) ;;')
      expect(job).toContain('echo "decision=$decision" >> "$GITHUB_OUTPUT"')
      expect(job).not.toContain('echo "decision=$(jq')
    }
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

  it.each(['auto-release.yml', 'publish-extension.yml'])(
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
