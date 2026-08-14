// @vitest-environment node

import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const checkerPath = resolve('scripts', 'check-docs.mjs')

const runChecker = async ({
  adr,
  docsIndex = '# Documentation\n',
  generatedReport = false,
  historicalAdr,
  readme = '# Repository\n\n[Documentation](docs/README.md)\n',
  workflow
}: {
  adr?: string
  docsIndex?: string
  generatedReport?: boolean
  historicalAdr?: string
  readme?: string
  workflow?: string
} = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'content-lens-check-docs-'))
  const scriptsDirectory = join(root, 'scripts')
  const docsDirectory = join(root, 'docs')
  await mkdir(scriptsDirectory, { recursive: true })
  await mkdir(docsDirectory, { recursive: true })

  const checkerSource = await readFile(checkerPath, 'utf8')
  await writeFile(join(scriptsDirectory, 'check-docs.mjs'), checkerSource)
  await writeFile(join(root, 'README.md'), readme)
  await writeFile(join(docsDirectory, 'README.md'), docsIndex)

  if (adr !== undefined) {
    const adrDirectory = join(docsDirectory, 'adr')
    await mkdir(adrDirectory, { recursive: true })
    await writeFile(join(adrDirectory, '0001-decision.md'), adr)
  }

  if (historicalAdr !== undefined) {
    const adrDirectory = join(docsDirectory, 'adr')
    await mkdir(adrDirectory, { recursive: true })
    await writeFile(
      join(adrDirectory, '0013-extension-toolchain-layout.md'),
      historicalAdr
    )
  }

  if (workflow !== undefined) {
    const workflowDirectory = join(root, '.github', 'workflows')
    await mkdir(workflowDirectory, { recursive: true })
    await writeFile(join(workflowDirectory, 'ci.yml'), workflow)
  }

  if (generatedReport) {
    const reportDirectory = join(root, 'playwright-report', 'data')
    await mkdir(reportDirectory, { recursive: true })
    await writeFile(
      join(reportDirectory, 'generated.md'),
      '# Generated report\n\n# Duplicate heading with trailing whitespace.   '
    )
  }

  const result = spawnSync(
    process.execPath,
    [join(scriptsDirectory, 'check-docs.mjs')],
    { cwd: root, encoding: 'utf8' }
  )

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout
  }
}

describe('documentation checker', () => {
  it('accepts valid Markdown and ignores generated browser reports', async () => {
    const result = await runChecker({ generatedReport: true })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Validated 2 Markdown files.')
  })

  it('rejects a missing local link', async () => {
    const result = await runChecker({
      readme: '# Repository\n\n[Missing](docs/missing.md)\n'
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'missing local link target: docs/missing.md'
    )
  })

  it('rejects a link that escapes the repository', async () => {
    const result = await runChecker({
      docsIndex: '# Documentation\n\n[Outside](../../outside.md)\n'
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('link escapes repository: ../../outside.md')
  })

  it('requires the status, context and decision fields in ADRs', async () => {
    const result = await runChecker({ adr: '# Decision\n' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('missing required ADR field: Status:')
    expect(result.stderr).toContain('missing required ADR field: ## Context')
    expect(result.stderr).toContain('missing required ADR field: ## Decision')
  })

  it('rejects operational Corepack commands in guides and workflows', async () => {
    const guide = await runChecker({
      readme: '# Repository\n\n```sh\ncorepack enable\n```\n'
    })
    const workflow = await runChecker({
      workflow:
        'jobs:\n  validate:\n    steps:\n      - run: corepack pnpm install\n'
    })

    expect(guide.status).toBe(1)
    expect(guide.stderr).toContain(
      'README.md: Corepack commands are forbidden in operational guidance'
    )
    expect(workflow.status).toBe(1)
    expect(workflow.stderr).toContain(
      '.github/workflows/ci.yml: Corepack commands are forbidden in operational guidance'
    )
  })

  it('allows the accepted ADR 0013 historical transcript', async () => {
    const result = await runChecker({
      historicalAdr: [
        '# ADR 0013: Toolchain',
        '',
        'Status: Accepted',
        '',
        '## Context',
        '',
        'Historical probe: `corepack pnpm install`.',
        '',
        '## Decision',
        '',
        'pnpm is the package manager.',
        ''
      ].join('\n')
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })
})
