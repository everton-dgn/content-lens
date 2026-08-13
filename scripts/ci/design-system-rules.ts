import postcss from 'postcss'

const remoteFontSourcePattern =
  /@import\s+(?:url\()?["']?https?:\/\/|url\(\s*["']?https?:\/\/[^)]*(?:font|woff|ttf|otf)/iu
const standaloneSerifPattern = /(?:^|[\s,])serif(?:[\s,;]|$)/iu
const tokenReferencePattern = /var\((--cl-[a-z0-9-]+)/gu
const unsupportedGradientPattern =
  /(?:linear|conic|repeating-linear|repeating-radial)-gradient\s*\(/iu
const absoluteFontSizePattern = /^(\d*\.?\d+)(px|rem)$/iu
const fontSizeTokenPattern = /^var\(--cl-font-size-[a-z0-9-]+\)$/iu
const fontSizeCalculationPattern =
  /^calc\(var\(--cl-font-size-[a-z0-9-]+\)\s*\*\s*(\d*\.?\d+)\)$/iu
const injectedFontSizePattern =
  /^\$\{injectedPrimitiveTokens\.font\.size[A-Z][a-zA-Z0-9]*\}$/u
const runtimeFontSizePattern =
  /\bsize[A-Z][a-zA-Z0-9]*\s*:\s*['"](\d*\.?\d+)(px|rem)['"]/gu

export const minimumUiFontSizePx = 12

const toCssPixels = (rawValue: string, unit: string) => {
  const value = Number.parseFloat(rawValue)
  return unit.toLowerCase() === 'rem' ? value * 16 : value
}

export type DuplicateCssSelector = {
  line: number
  selector: string
}

export function findDuplicateTopLevelCssSelectors(
  source: string
): DuplicateCssSelector[] {
  const seen = new Set<string>()
  const duplicates: DuplicateCssSelector[] = []
  const root = postcss.parse(source)

  root.each(node => {
    if (node.type !== 'rule') {
      return
    }
    if (seen.has(node.selector)) {
      duplicates.push({
        line: node.source?.start?.line ?? 1,
        selector: node.selector
      })
      return
    }
    seen.add(node.selector)
  })

  return duplicates
}

export function validateEmberGateCssLine(line: string): string[] {
  const issues: string[] = []
  const trimmed = line.trim()

  if (unsupportedGradientPattern.test(trimmed)) {
    issues.push('Ember Gate permits only a token-based radial focal glow')
  }
  if (/^(?:-webkit-)?backdrop-filter\s*:/iu.test(trimmed)) {
    issues.push('glass effects are forbidden by Ember Gate')
  }

  return issues
}

export function validateEmberGatePrimitives(source: string): string[] {
  const issues: string[] = []

  const radii = {
    sm: '0.5',
    md: '0.625',
    lg: '0.75'
  } as const
  for (const [token, expected] of Object.entries(radii)) {
    const value = new RegExp(
      `--cl-radius-${token}\\s*:\\s*([0-9.]+)rem\\s*;`,
      'iu'
    ).exec(source)?.[1]
    if (value !== expected) {
      issues.push(`--cl-radius-${token} must remain ${expected}rem`)
    }
  }
  for (const token of ['soft', 'deep'] as const) {
    const value = new RegExp(
      `--cl-shadow-${token}\\s*:\\s*([^;]+);`,
      'iu'
    ).exec(source)?.[1]
    if (value === undefined || value.trim() === 'none') {
      issues.push(`--cl-shadow-${token} must define tokenized elevation`)
    }
  }
  if (!/--cl-gate-width\s*:\s*0\.1875rem\s*;/iu.test(source)) {
    issues.push('--cl-gate-width must remain the three-pixel signature')
  }

  return issues
}

export function validateCssTokenReferences(
  line: string,
  declaredTokens: ReadonlySet<string>
): string[] {
  return [
    ...new Set(
      [...line.matchAll(tokenReferencePattern)]
        .map(match => match[1])
        .filter(
          (token): token is string =>
            token !== undefined && !declaredTokens.has(token)
        )
        .map(token => `undefined design token ${token}`)
    )
  ]
}

export function validateCssTypographyLine(
  line: string,
  isPrimitiveTokenFile: boolean
): string[] {
  const issues: string[] = []
  const trimmed = line.trim()

  if (/^@font-face\b/iu.test(trimmed)) {
    issues.push('custom font faces are forbidden')
  }
  if (remoteFontSourcePattern.test(trimmed)) {
    issues.push('remote font source is forbidden')
  }
  if (
    /^font\s*:/iu.test(trimmed) &&
    !/^font\s*:\s*inherit\s*;/iu.test(trimmed)
  ) {
    issues.push('font shorthand is forbidden')
  }
  if (
    /\bfont-family\s*:/u.test(trimmed) &&
    !isPrimitiveTokenFile &&
    !trimmed.includes('var(--cl-font-') &&
    !trimmed.includes('injectedPrimitiveTokens.font.family')
  ) {
    issues.push('font family must use a token')
  }
  const fontSize = /^font-size\s*:\s*([^;]+)\s*;/iu.exec(trimmed)?.[1]?.trim()
  if (fontSize) {
    const calculation = fontSizeCalculationPattern.exec(fontSize)
    const usesRegisteredSize =
      fontSize === 'inherit' ||
      fontSizeTokenPattern.test(fontSize) ||
      injectedFontSizePattern.test(fontSize) ||
      (calculation?.[1] !== undefined && Number.parseFloat(calculation[1]) >= 1)
    if (!usesRegisteredSize) {
      issues.push(
        'font size must use a registered 12px-or-larger font-size token'
      )
    }
  }

  return issues
}

export function validateUiFontPrimitive(source: string): string[] {
  const value = /--cl-font-ui\s*:\s*([^;]+);/iu.exec(source)?.[1]
  if (
    value === undefined ||
    !value.includes('sans-serif') ||
    standaloneSerifPattern.test(value)
  ) {
    return ['UI font primitive must be sans-serif']
  }
  return []
}

export function validateFontSizePrimitives(source: string): string[] {
  const issues: string[] = []
  const root = postcss.parse(source)

  root.walkDecls(/^--cl-font-size-/u, declaration => {
    const match = absoluteFontSizePattern.exec(declaration.value.trim())
    if (!match?.[1] || !match[2]) {
      issues.push(
        `${declaration.prop} must use px or rem so the ${minimumUiFontSizePx}px floor can be verified`
      )
      return
    }
    const pixels = toCssPixels(match[1], match[2])
    if (pixels < minimumUiFontSizePx) {
      issues.push(
        `${declaration.prop} resolves to ${pixels}px; UI font sizes must be at least ${minimumUiFontSizePx}px`
      )
    }
  })

  return issues
}

export function validateRuntimeFontSizes(source: string): string[] {
  const issues: string[] = []

  for (const match of source.matchAll(runtimeFontSizePattern)) {
    if (!match[1] || !match[2]) {
      continue
    }
    const pixels = toCssPixels(match[1], match[2])
    if (pixels < minimumUiFontSizePx) {
      issues.push(
        `runtime font size resolves to ${pixels}px; UI font sizes must be at least ${minimumUiFontSizePx}px`
      )
    }
  }

  return issues
}

const stateToneAttributePattern = /\btone=\{?"([a-z-]+)"/gu
const stateAttributePattern = /\b(?:state|status)=\{?"([a-z-]+)"/gu

export function validateStateVocabulary(
  source: string,
  vocabulary: readonly string[]
): string[] {
  const allowed = new Set([...vocabulary, 'neutral', 'subtle'])
  const issues: string[] = []

  for (const pattern of [stateToneAttributePattern, stateAttributePattern]) {
    pattern.lastIndex = 0
    for (const match of source.matchAll(pattern)) {
      const value = match[1]
      if (value && !allowed.has(value)) {
        issues.push(
          `"${value}" is not in the closed state vocabulary; use one of ${[...allowed].sort().join(', ')}`
        )
      }
    }
  }

  return issues
}
