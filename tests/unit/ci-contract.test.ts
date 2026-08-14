import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('pull-request CI contract', () => {
  it.each(['ci.yml', 'docs.yml'])(
    'keeps %s immutable, read-only and credential-free',
    async workflowName => {
      const workflow = await readFile(
        resolve('.github', 'workflows', workflowName),
        'utf8'
      )
      const actionReferences = [...workflow.matchAll(/uses:\s+\S+@(\S+)/gu)]
      const permissions = workflow.match(
        /^permissions:\n((?: {2}.+\n)*)/mu
      )?.[1]

      expect(permissions).toBe('  contents: read\n')
      expect(workflow).not.toMatch(/^[ \t]+permissions:/mu)
      expect(workflow).toContain('pull_request:')
      expect(workflow).toContain('cancel-in-progress: true')
      expect(workflow).toContain('persist-credentials: false')
      expect(workflow).not.toContain('pull_request_target')
      expect(workflow).not.toMatch(/\bsecrets(?:\.|:)/u)
      expect(workflow).not.toMatch(/\bgithub\.token\b|\bGITHUB_TOKEN\b/u)
      expect(actionReferences.length).toBeGreaterThan(0)
      for (const reference of actionReferences) {
        expect(reference[1]).toMatch(/^[0-9a-f]{40}$/u)
      }
    }
  )

  it('runs the complete local gate and packaged smoke', async () => {
    const workflow = await readFile(
      resolve('.github', 'workflows', 'ci.yml'),
      'utf8'
    )

    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm ci:local')
    expect(workflow).toContain('/tmp/actionlint')
    expect(workflow).toContain('pnpm release:package -- --channel dev')
    expect(workflow).toContain('pnpm release:guard -- --directory')
    expect(workflow).toContain(
      'pnpm exec playwright install --with-deps chromium firefox'
    )
    expect(workflow).toContain('pnpm test:browser')
    expect(workflow).toContain('pnpm test:browser:packaged')
    expect(workflow).not.toContain('pnpm test:browser panel-open-smoke')
    expect(workflow).not.toContain('pnpm test:browser --')
    expect(workflow).toContain('  static-and-unit:')
    expect(workflow).toContain('  browser-and-visual:')
    expect(workflow).toContain('  package:')
    expect(workflow).toContain('  ci:')
    expect(workflow).toContain('Require every CI lane')
    expect(workflow.match(/pnpm ci:local/gu)).toHaveLength(1)
    expect(workflow.match(/pnpm test:browser$/gmu)).toHaveLength(1)
    expect(workflow.match(/pnpm test:browser:packaged/gu)).toHaveLength(1)
  })

  it('keeps dependency graph and toolchain integrity in the local gate', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve('package.json'), 'utf8')
    ) as {
      packageManager: string
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['ci:local']).toContain('pnpm deps:check')
    expect(packageJson.scripts['deps:check']).toContain(
      'knip --strict --include dependencies,unlisted'
    )
    expect(packageJson.scripts['deps:check']).toContain(
      'knip --include unlisted,unresolved,binaries'
    )
    expect(packageJson.scripts['deps:check']).toContain('knip --cycles')
    expect(packageJson.packageManager).toBe(
      'pnpm@11.17.0+sha512.cca3cea332ad254bb84145f966d19f4879615210346fc92c79a047f23a0d7b3cca3c3792f0076ba1f1831d277efbcf0a9119b31a9a60eca7fb3d6231f331ef72'
    )
  })

  it('installs exact pnpm directly and blocks operational Corepack commands', async () => {
    const [readme, sourceReview, gettingStarted, docsCheck] = await Promise.all(
      [
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('SOURCE_CODE_REVIEW.md'), 'utf8'),
        readFile(resolve('docs/getting-started.md'), 'utf8'),
        readFile(resolve('scripts/check-docs.mjs'), 'utf8')
      ]
    )

    for (const guide of [readme, sourceReview, gettingStarted]) {
      expect(guide).toContain('npm install --global pnpm@11.17.0')
      expect(guide).not.toMatch(/\bcorepack\s+(?:enable|pnpm)\b/iu)
    }
    expect(docsCheck).toContain('forbiddenCorepackCommand')
    expect(docsCheck).toContain("'.github', 'workflows'")
    expect(docsCheck).toContain("'docs/adr/0013-extension-toolchain-layout.md'")
  })

  it('keeps focused test commands mapped to their owned suites', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve('package.json'), 'utf8')
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts).toMatchObject({
      'test:contract': 'vitest run --project unit tests/contract',
      'test:fault': 'vitest run --project unit tests/fault',
      'test:security': 'vitest run --project unit tests/security',
      'test:storage': 'vitest run --project unit tests/storage',
      'test:sync': 'vitest run --project unit tests/sync',
      'test:w': 'vitest'
    })
  })

  it('keeps the explicit commit header limit at the existing strictness', async () => {
    const config = await readFile(resolve('commitlint.config.mjs'), 'utf8')

    expect(config).toContain("extends: ['@commitlint/config-conventional']")
    expect(config).toContain("'header-max-length': [2, 'always', 100]")
  })

  it('scans the working tree for secrets with a pinned scanner', async () => {
    const workflow = await readFile(
      resolve('.github', 'workflows', 'ci.yml'),
      'utf8'
    )
    const hooks = await readFile(resolve('.lefthook.yml'), 'utf8')
    const packageJson = JSON.parse(
      await readFile(resolve('package.json'), 'utf8')
    ) as { scripts: Record<string, string> }

    expect(workflow).toContain(
      'https://github.com/mongodb/kingfisher/releases/download/v1.110.0/kingfisher-linux-x64.tgz'
    )
    expect(workflow).toContain(
      'echo "f55296fe4c6090c27963b2f62f5938e90b187ab1357466c8661d3786f6be7f14  /tmp/kingfisher.tar.gz" | sha256sum --check'
    )
    expect(workflow).toMatch(/PATH="\/tmp:\$\{PATH\}" pnpm scan:secrets/u)
    expect(packageJson.scripts['scan:secrets']).toContain('kingfisher scan .')
    expect(packageJson.scripts['scan:secrets']).toContain('--git-history none')
    expect(packageJson.scripts['scan:secrets']).toContain('--no-validate')
    expect(packageJson.scripts['scan:secrets']).toContain('--redact')
    expect(packageJson.scripts['scan:secrets']).toContain(
      '--exclude node_modules'
    )
    expect(hooks).toContain('command -v kingfisher')
    expect(hooks).toMatch(/command -v kingfisher[\s\S]*?exit 0/u)
    expect(hooks).toContain('pnpm scan:secrets --staged')
  })

  it('runs the design-system contract inside the public gate', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve('package.json'), 'utf8')
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts['design-system:check']).toBe(
      'node scripts/ci/design-system-guard.ts'
    )
    expect(packageJson.scripts['guard:public']).toContain(
      'pnpm design-system:check'
    )
    expect(packageJson.scripts['ci:local']).toContain('pnpm guard:public')
  })

  it('limits automated dependency updates to monthly GitHub Actions bumps', async () => {
    const dependabot = await readFile(
      resolve('.github', 'dependabot.yml'),
      'utf8'
    )

    expect(dependabot).toContain('package-ecosystem: github-actions')
    expect(dependabot).not.toContain('package-ecosystem: npm')
    expect(dependabot).toContain('interval: monthly')
    expect(dependabot).toContain('rebase-strategy: disabled')
  })
})

describe('performance budget gate', () => {
  it('runs the benchmarks that assert the documented budgets', async () => {
    const workflow = await readFile(
      resolve('.github', 'workflows', 'ci.yml'),
      'utf8'
    )

    expect(workflow).toContain('run: pnpm benchmark')
  })

  it('keeps every documented budget backed by an executable assertion', async () => {
    const [manifest, ...benchmarks] = await Promise.all([
      readFile(resolve('package.json'), 'utf8'),
      readFile(resolve('tests/performance/rule-index.bench.ts'), 'utf8'),
      readFile(resolve('tests/performance/phase4-adapters.bench.ts'), 'utf8'),
      readFile(resolve('tests/performance/similarity-index.bench.ts'), 'utf8'),
      readFile(resolve('tests/performance/sync-merge.bench.ts'), 'utf8'),
      readFile(resolve('tests/performance/native-feedback.bench.ts'), 'utf8')
    ])

    expect(JSON.parse(manifest).scripts.benchmark).toContain(
      'vitest.benchmark.config.ts'
    )
    for (const benchmark of benchmarks) {
      expect(benchmark).toMatch(/expect\(/u)
    }
  })
})

describe('visual regression lane wiring', () => {
  it('runs the lane unconditionally, against a bundle it just built', async () => {
    const workflow = await readFile(
      resolve('.github', 'workflows', 'ci.yml'),
      'utf8'
    )
    const buildIndex = workflow.indexOf('pnpm build:chrome')
    const laneIndex = workflow.indexOf('pnpm test:visual')

    // The lane renders `.output/chrome-mv3` through the preview fixture, so a
    // build has to precede it. It used to be skipped when the Linux baselines
    // were missing; they are committed now and the check is required.
    expect(buildIndex).toBeGreaterThan(-1)
    expect(laneIndex).toBeGreaterThan(buildIndex)
    expect(workflow).not.toMatch(/if \[ -d tests\/visual/u)
  })

  it('keeps a Linux baseline for every macOS one', async () => {
    const root = resolve('tests', 'visual', '__screenshots__')
    const [darwin, linux] = await Promise.all([
      readdir(resolve(root, 'darwin')),
      readdir(resolve(root, 'linux'))
    ])

    expect(darwin.length).toBeGreaterThan(0)
    expect([...linux].sort()).toEqual([...darwin].sort())
  })

  it('keeps the baseline generator manual, read-only and SHA-pinned', async () => {
    const workflow = await readFile(
      resolve('.github', 'workflows', 'visual-baselines.yml'),
      'utf8'
    )
    const actionReferences = [...workflow.matchAll(/uses:\s+\S+@(\S+)/gu)]

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toContain('pull_request')
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/mu)
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).not.toMatch(/\bsecrets(?:\.|:)/u)
    expect(actionReferences.length).toBeGreaterThan(0)
    for (const reference of actionReferences) {
      expect(reference[1]).toMatch(/^[0-9a-f]{40}$/u)
    }
  })

  it('verifies the generated baselines before publishing them', async () => {
    const workflow = await readFile(
      resolve('.github', 'workflows', 'visual-baselines.yml'),
      'utf8'
    )
    const updateIndex = workflow.indexOf('--update-snapshots')
    const counterpartIndex = workflow.indexOf('Confirm every committed')
    const verifyIndex = workflow.indexOf('Confirm the lane passes')
    const uploadIndex = workflow.indexOf('upload-artifact')

    // Playwright fails a test whose snapshot it had to create, so the writing
    // step cannot gate the job. These two checks do it instead.
    expect(updateIndex).toBeGreaterThan(-1)
    expect(counterpartIndex).toBeGreaterThan(updateIndex)
    expect(verifyIndex).toBeGreaterThan(counterpartIndex)
    expect(uploadIndex).toBeGreaterThan(verifyIndex)
  })
})

describe('performance budget regimes', () => {
  it('keeps the reference budget exact and widens it only off that device', async () => {
    const { effectiveBudgetMs, budgetRegime, SHARED_RUNNER_FACTOR } =
      await import('../performance/budget')
    const previous = process.env.CI

    try {
      process.env.CI = ''
      expect(budgetRegime()).toBe('reference-device')
      expect(effectiveBudgetMs(50)).toBe(50)

      process.env.CI = '1'
      expect(budgetRegime()).toBe('shared-runner')
      expect(effectiveBudgetMs(50)).toBe(50 * SHARED_RUNNER_FACTOR)
    } finally {
      if (previous === undefined) {
        process.env.CI = undefined
      } else {
        process.env.CI = previous
      }
    }
  })

  it('makes every benchmark declare which regime it measured under', async () => {
    const files = [
      'tests/performance/rule-index.bench.ts',
      'tests/performance/phase4-adapters.bench.ts',
      'tests/performance/similarity-index.bench.ts',
      'tests/performance/sync-merge.bench.ts',
      'tests/performance/native-feedback.bench.ts'
    ]

    for (const file of files) {
      const source = await readFile(resolve(file), 'utf8')
      expect(source, file).toContain('effectiveBudgetMs')
    }
  })
})
