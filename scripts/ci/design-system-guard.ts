import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import {
  DESIGN_SYSTEM_VERSION,
  panelStatuses,
  viewStates
} from '../../src/ui/styles/tokens/contract.ts'
import { designTokenRegistry } from '../../src/ui/styles/tokens/registry.ts'
import {
  findDuplicateTopLevelCssSelectors,
  validateCssTokenReferences,
  validateCssTypographyLine,
  validateEmberGateCssLine,
  validateEmberGatePrimitives,
  validateFontSizePrimitives,
  validateRuntimeFontSizes,
  validateStateVocabulary,
  validateUiFontPrimitive
} from './design-system-rules.ts'

const root = resolve(import.meta.dirname, '../..')
const errors: string[] = []
const componentRoot = resolve(root, 'src/ui/components')
const tokenRoot = resolve(root, 'src/ui/styles/tokens')
const injectedPrimitiveFile = resolve(tokenRoot, 'injected-primitives.ts')
const injectedStyleFile = resolve(tokenRoot, 'injected.ts')
const cssRoots = [
  resolve(root, 'src/ui'),
  resolve(root, 'src/entrypoints/sidepanel')
]
const tsxRoots = [
  resolve(root, 'src/ui'),
  resolve(root, 'src/entrypoints/sidepanel')
]
const expectedComponents = [
  'Badge.tsx',
  'BackAction.tsx',
  'Button.tsx',
  'ChoiceGroup.tsx',
  'Combobox.tsx',
  'DataList.tsx',
  'Dialog.tsx',
  'Disclosure.tsx',
  'Field.tsx',
  'FileField.tsx',
  'Notice.tsx',
  'Progress.tsx',
  'SecretField.tsx',
  'SectionNav.tsx',
  'SelectField.tsx',
  'SidepanelShell.tsx',
  'SettingRow.tsx',
  'StatePanel.tsx',
  'StatusRail.tsx',
  'Surface.tsx',
  'SwitchField.tsx',
  'ToggleField.tsx'
]
const widePanelQuery = '@media (width > 24rem) {'
const primitiveTokens = readFileSync(
  resolve(tokenRoot, 'primitives.css'),
  'utf8'
)
const semanticTokens = readFileSync(resolve(tokenRoot, 'semantic.css'), 'utf8')
const declaredTokenNames = [
  ...new Set(
    [primitiveTokens, semanticTokens].flatMap(
      source => source.match(/--cl-[a-z0-9-]+(?=\s*:)/gu) ?? []
    )
  )
].sort()
const declaredTokenSet = new Set(declaredTokenNames)

function collectFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap(entry => {
      const absolute = join(directory, entry)
      return statSync(absolute).isDirectory()
        ? collectFiles(absolute)
        : [absolute]
    })
    .sort()
}

function report(file: string, line: number, message: string) {
  errors.push(`${relative(root, file)}:${line}: ${message}`)
}

for (const expected of expectedComponents) {
  const file = resolve(componentRoot, expected)
  const content = readFileSync(file, 'utf8')
  if (!content.includes('data-slot="')) {
    errors.push(`${relative(root, file)}: missing stable data-slot`)
  }
}

for (const tsxRoot of tsxRoots) {
  for (const file of collectFiles(tsxRoot).filter(entry =>
    entry.endsWith('.tsx')
  )) {
    const content = readFileSync(file, 'utf8')
    content.split('\n').forEach((line, index) => {
      if (/\bstyle\s*=/u.test(line)) {
        report(file, index + 1, 'inline style is forbidden')
      }
      if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/iu.test(line)) {
        report(file, index + 1, 'raw color is forbidden')
      }
    })
  }
}

for (const cssRoot of cssRoots) {
  for (const file of collectFiles(cssRoot).filter(entry =>
    entry.endsWith('.css')
  )) {
    const isPrimitiveTokenFile = file === resolve(tokenRoot, 'primitives.css')
    const source = readFileSync(file, 'utf8')
    for (const duplicate of findDuplicateTopLevelCssSelectors(source)) {
      report(
        file,
        duplicate.line,
        `duplicate top-level selector ${duplicate.selector}`
      )
    }
    source.split('\n').forEach((line, index) => {
      const trimmed = line.trim()
      for (const issue of validateCssTypographyLine(
        line,
        isPrimitiveTokenFile
      )) {
        report(file, index + 1, issue)
      }
      for (const issue of validateCssTokenReferences(line, declaredTokenSet)) {
        report(file, index + 1, issue)
      }
      for (const issue of validateEmberGateCssLine(line)) {
        report(file, index + 1, issue)
      }
      if (isPrimitiveTokenFile) {
        return
      }
      if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/iu.test(line)) {
        report(file, index + 1, 'raw color must be a primitive token')
      }
      if (
        /(?:^|[\s:(])\d*\.?\d+(?:px|rem|em|ms)\b/u.test(line) &&
        !trimmed.startsWith('@media')
      ) {
        report(file, index + 1, 'length or duration must use a token')
      }
      if (trimmed.startsWith('@media') && trimmed.includes('rem')) {
        if (trimmed !== widePanelQuery) {
          report(file, index + 1, 'unknown responsive breakpoint')
        }
      }
    })
  }
}

const stateVocabulary = [...new Set([...panelStatuses, ...viewStates])]

for (const tsxRoot of tsxRoots) {
  for (const file of collectFiles(tsxRoot).filter(candidate =>
    candidate.endsWith('.tsx')
  )) {
    for (const issue of validateStateVocabulary(
      readFileSync(file, 'utf8'),
      stateVocabulary
    )) {
      errors.push(`${relative(root, file)}: ${issue}`)
    }
  }
}

for (const issue of validateUiFontPrimitive(primitiveTokens)) {
  errors.push(`src/ui/styles/tokens/primitives.css: ${issue}`)
}
for (const issue of validateFontSizePrimitives(primitiveTokens)) {
  errors.push(`src/ui/styles/tokens/primitives.css: ${issue}`)
}
for (const issue of validateEmberGatePrimitives(primitiveTokens)) {
  errors.push(`src/ui/styles/tokens/primitives.css: ${issue}`)
}
const injectedPrimitives = readFileSync(injectedPrimitiveFile, 'utf8')
const injectedStyles = readFileSync(injectedStyleFile, 'utf8')
const contract = readFileSync(resolve(tokenRoot, 'contract.ts'), 'utf8')
const designSystemDocs = readFileSync(
  resolve(root, 'docs/design-system/README.md'),
  'utf8'
)
const aiRules = readFileSync(
  resolve(root, 'docs/design-system/ai-generation.md'),
  'utf8'
)
const panelInteractionTests = readFileSync(
  resolve(root, 'tests/ui/panel-interactions.test.tsx'),
  'utf8'
)
const packagedJourney = readFileSync(
  resolve(root, 'tests/browser/v01-journey.spec.ts'),
  'utf8'
)
const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8')

for (const issue of validateRuntimeFontSizes(injectedPrimitives)) {
  errors.push(`${relative(root, injectedPrimitiveFile)}: ${issue}`)
}

injectedStyles.split('\n').forEach((line, index) => {
  for (const issue of validateCssTypographyLine(line, false)) {
    report(injectedStyleFile, index + 1, issue)
  }
  if (
    /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\d*\.?\d+(?:px|rem|em|ms)\b/iu.test(line)
  ) {
    report(
      injectedStyleFile,
      index + 1,
      'injected styles must use synchronized runtime primitives'
    )
  }
})

for (const [, runtimeValue] of injectedPrimitives.matchAll(
  /"(#[0-9a-f]{6}|\d*\.?\d+(?:rem|ms))"/giu
)) {
  if (runtimeValue && !primitiveTokens.includes(runtimeValue)) {
    errors.push(
      `${relative(root, injectedPrimitiveFile)}: ${runtimeValue} is not synchronized with primitives.css`
    )
  }
}

for (const versionSource of [primitiveTokens, contract, designSystemDocs]) {
  if (!versionSource.includes(DESIGN_SYSTEM_VERSION)) {
    errors.push(
      `design-system version ${DESIGN_SYSTEM_VERSION} is not synchronized`
    )
  }
}

const registeredTokenNames = Object.keys(designTokenRegistry).sort()
if (
  JSON.stringify(declaredTokenNames) !== JSON.stringify(registeredTokenNames)
) {
  errors.push(
    'src/ui/styles/tokens/registry.ts: token metadata must match every declared CSS token exactly'
  )
}
for (const [name, metadata] of Object.entries(designTokenRegistry)) {
  if (
    metadata.name !== name ||
    metadata.version !== DESIGN_SYSTEM_VERSION ||
    metadata.description.trim().length <= 20 ||
    metadata.modes.length === 0
  ) {
    errors.push(
      `src/ui/styles/tokens/registry.ts: incomplete lifecycle metadata for ${name}`
    )
  }
}

for (const component of expectedComponents.map(file =>
  file.replace('.tsx', '')
)) {
  if (!designSystemDocs.includes(`\`${component}\``)) {
    errors.push(`docs/design-system/README.md: missing ${component} guidance`)
  }
}

for (const requiredRule of [
  'Raw color',
  'Inline `style`',
  'More than one visible primary',
  '200% zoom',
  'injected-primitives.ts',
  'reduced motion',
  'Serif or remote font',
  'visible native file picker',
  'Ember Gate',
  'Token-based radial glow',
  'Rounded navigation',
  'shared component',
  'without encoding status',
  '12 CSS px'
]) {
  if (!aiRules.includes(requiredRule)) {
    errors.push(
      `docs/design-system/ai-generation.md: missing rule ${requiredRule}`
    )
  }
}

if (!packageJson.includes('"design-system:check"')) {
  errors.push('package.json: missing design-system:check script')
}
if (!packageJson.includes('pnpm design-system:check')) {
  errors.push('package.json: public guard does not run design-system:check')
}
if (
  !panelInteractionTests.includes('[data-variant="primary"]') ||
  !panelInteractionTests.includes('toHaveLength(1)')
) {
  errors.push(
    'tests/ui/panel-interactions.test.tsx: missing primary-action composition gate'
  )
}
if (
  !packagedJourney.includes('[data-variant="danger"]:visible') ||
  !packagedJourney.includes('assertOnePrimaryAction')
) {
  errors.push(
    'tests/browser/v01-journey.spec.ts: missing packaged primary-or-danger gate'
  )
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(
    `Design system ${expectedComponents.length} components and token boundaries validated.`
  )
}
