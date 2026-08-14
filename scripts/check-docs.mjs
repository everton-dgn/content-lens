import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const ignoredDirectories = new Set([
  '.git',
  '.output',
  'coverage',
  'node_modules',
  'playwright-report',
  'test-results'
])
const errors = []
const historicalCorepackEvidence = new Set([
  'docs/adr/0013-extension-toolchain-layout.md'
])
const forbiddenCorepackCommand = /\bcorepack\s+(?:enable|pnpm)\b/i

function collectMarkdown(directory) {
  return readdirSync(directory)
    .flatMap(entry => {
      const absolute = join(directory, entry)
      const relativePath = relative(root, absolute)

      if (statSync(absolute).isDirectory()) {
        return ignoredDirectories.has(entry) ? [] : collectMarkdown(absolute)
      }

      return entry.endsWith('.md') ? [relativePath] : []
    })
    .sort()
}

function checkLocalLinks(file, content) {
  const linkPattern = /\[[^\]]*]\(([^)]+)\)/g

  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '')

    if (
      rawTarget === '' ||
      rawTarget.startsWith('#') ||
      /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
    ) {
      continue
    }

    const targetPath = decodeURIComponent(rawTarget.split('#')[0])
    const absoluteTarget = normalize(resolve(root, dirname(file), targetPath))

    if (!absoluteTarget.startsWith(`${root}/`) && absoluteTarget !== root) {
      errors.push(`${file}: link escapes repository: ${rawTarget}`)
    } else if (!existsSync(absoluteTarget)) {
      errors.push(`${file}: missing local link target: ${rawTarget}`)
    }
  }
}

function checkAdr(file, content) {
  if (!file.startsWith('docs/adr/')) {
    return
  }

  for (const section of ['Status:', '## Context', '## Decision']) {
    if (!content.includes(section)) {
      errors.push(`${file}: missing required ADR field: ${section}`)
    }
  }
}

function checkOperationalCorepack(file, content) {
  if (
    !historicalCorepackEvidence.has(file) &&
    forbiddenCorepackCommand.test(content)
  ) {
    errors.push(
      `${file}: Corepack commands are forbidden in operational guidance`
    )
  }
}

const markdownFiles = collectMarkdown(root)

for (const file of markdownFiles) {
  const content = readFileSync(resolve(root, file), 'utf8')

  if (!content.endsWith('\n')) {
    errors.push(`${file}: missing final newline`)
  }

  content.split('\n').forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      errors.push(`${file}:${index + 1}: trailing whitespace`)
    }
  })

  const h1Count = content.split('\n').filter(line => /^# /.test(line)).length
  if (h1Count !== 1) {
    errors.push(`${file}: expected exactly one H1, found ${h1Count}`)
  }

  checkLocalLinks(file, content)
  checkAdr(file, content)
  checkOperationalCorepack(file, content)
}

const workflowDirectory = resolve(root, '.github', 'workflows')
if (existsSync(workflowDirectory)) {
  for (const entry of readdirSync(workflowDirectory).sort()) {
    if (!/\.ya?ml$/i.test(entry)) continue
    const file = `.github/workflows/${entry}`
    checkOperationalCorepack(file, readFileSync(resolve(root, file), 'utf8'))
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Validated ${markdownFiles.length} Markdown files.`)
}
