import { describe, expect, it } from 'vitest'

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
} from '../../scripts/ci/design-system-rules'

describe('design-system typography rules', () => {
  it.each([
    ['font: 1rem Georgia, serif;', 'font shorthand is forbidden'],
    ['@font-face {', 'custom font faces are forbidden'],
    [
      '@import url("https://fonts.example.test/ui.css");',
      'remote font source is forbidden'
    ],
    [
      'src: url(https://fonts.example.test/ui.woff2);',
      'remote font source is forbidden'
    ]
  ])('rejects %s', (line, issue) => {
    expect(validateCssTypographyLine(line, false)).toContain(issue)
  })

  it('requires the complete UI font primitive to remain sans-serif', () => {
    expect(validateUiFontPrimitive('--cl-font-ui: Georgia, serif;')).toContain(
      'UI font primitive must be sans-serif'
    )
    expect(
      validateUiFontPrimitive(
        '--cl-font-ui:\n system-ui, "Segoe UI", sans-serif;'
      )
    ).toEqual([])
  })

  it('accepts the system UI stack and semantic font-family use', () => {
    expect(
      validateCssTypographyLine(
        '--cl-font-ui: system-ui, -apple-system, "Segoe UI", sans-serif;',
        true
      )
    ).toEqual([])
    expect(
      validateCssTypographyLine('font-family: var(--cl-font-ui);', false)
    ).toEqual([])
    expect(validateCssTypographyLine('font: inherit;', false)).toEqual([])
    expect(
      validateCssTypographyLine(
        `font-family: \${injectedPrimitiveTokens.font.family};`,
        false
      )
    ).toEqual([])
  })

  it('rejects font-size primitives below the 12px UI floor', () => {
    expect(
      validateFontSizePrimitives(`
        --cl-font-size-caption: 0.6875rem;
        --cl-font-size-label: 11px;
        --cl-font-size-body: 0.75rem;
      `)
    ).toEqual([
      '--cl-font-size-caption resolves to 11px; UI font sizes must be at least 12px',
      '--cl-font-size-label resolves to 11px; UI font sizes must be at least 12px'
    ])
  })

  it('accepts font-size primitives at or above 12px', () => {
    expect(
      validateFontSizePrimitives(`
        --cl-font-size-label: 0.75rem;
        --cl-font-size-body: 14px;
      `)
    ).toEqual([])
  })

  it('rejects unverifiable font-size primitives', () => {
    expect(validateFontSizePrimitives('--cl-font-size-label: 0.75em;')).toEqual(
      [
        '--cl-font-size-label must use px or rem so the 12px floor can be verified'
      ]
    )
  })

  it.each([
    'font-size: smaller;',
    'font-size: 75%;',
    'font-size: var(--cl-space-2);',
    'font-size: calc(var(--cl-font-size-md) * 0.5);'
  ])('rejects a font-size declaration that bypasses the scale: %s', line => {
    expect(validateCssTypographyLine(line, false)).toContain(
      'font size must use a registered 12px-or-larger font-size token'
    )
  })

  it.each([
    'font-size: inherit;',
    'font-size: var(--cl-font-size-xs);',
    'font-size: calc(var(--cl-font-size-display) * 2);',
    `font-size: \${injectedPrimitiveTokens.font.sizeBody};`
  ])('accepts a font-size declaration from the protected scale: %s', line => {
    expect(validateCssTypographyLine(line, false)).toEqual([])
  })

  it('enforces the floor for injected runtime typography', () => {
    expect(
      validateRuntimeFontSizes(`
        sizeCaption: '0.6875rem',
        sizeBody: '0.875rem'
      `)
    ).toEqual([
      'runtime font size resolves to 11px; UI font sizes must be at least 12px'
    ])
  })

  it('rejects CSS references to undeclared design tokens', () => {
    const declaredTokens = new Set(['--cl-font-ui', '--cl-font-size-lg'])

    expect(
      validateCssTokenReferences(
        'font-family: var(--cl-font-display); font-size: var(--cl-font-size-lg);',
        declaredTokens
      )
    ).toEqual(['undefined design token --cl-font-display'])
    expect(
      validateCssTokenReferences(
        'font-family: var(--cl-font-ui); font-size: var(--cl-font-size-lg);',
        declaredTokens
      )
    ).toEqual([])
  })
})

describe('Ember Gate visual rules', () => {
  it('rejects duplicate top-level selectors but allows responsive overrides', () => {
    expect(
      findDuplicateTopLevelCssSelectors(`
        .cl-surface { padding: var(--cl-space-2); }
        @media (width > 24rem) {
          .cl-surface { padding: var(--cl-space-3); }
        }
        .cl-surface { padding: var(--cl-space-4); }
      `)
    ).toEqual([{ line: 6, selector: '.cl-surface' }])
  })

  it.each([
    [
      'background: linear-gradient(red, blue);',
      'Ember Gate permits only a token-based radial focal glow'
    ],
    [
      'backdrop-filter: blur(1rem);',
      'glass effects are forbidden by Ember Gate'
    ]
  ])('rejects %s', (line, issue) => {
    expect(validateEmberGateCssLine(line)).toContain(issue)
  })

  it('accepts the focal glow, elevation and canonical visual primitives', () => {
    expect(
      validateEmberGateCssLine(
        'background: radial-gradient(circle, var(--cl-color-action), transparent);'
      )
    ).toEqual([])
    expect(
      validateEmberGateCssLine('box-shadow: var(--cl-shadow-soft);')
    ).toEqual([])
    expect(
      validateEmberGatePrimitives(`
        --cl-radius-sm: 0.5rem;
        --cl-radius-md: 0.625rem;
        --cl-radius-lg: 0.75rem;
        --cl-gate-width: 0.1875rem;
        --cl-shadow-soft: 0 0.5rem 1.5rem black;
        --cl-shadow-deep: 0 1.25rem 3rem black;
      `)
    ).toEqual([])
  })

  it('rejects radius, shadow and gate drift', () => {
    expect(
      validateEmberGatePrimitives(`
        --cl-radius-sm: 0.125rem;
        --cl-radius-md: 0.5rem;
        --cl-radius-lg: 0.75rem;
        --cl-gate-width: 0.125rem;
        --cl-shadow-soft: none;
        --cl-shadow-deep: none;
      `)
    ).toEqual([
      '--cl-radius-sm must remain 0.5rem',
      '--cl-radius-md must remain 0.625rem',
      '--cl-shadow-soft must define tokenized elevation',
      '--cl-shadow-deep must define tokenized elevation',
      '--cl-gate-width must remain the three-pixel signature'
    ])
  })
})

describe('state vocabulary', () => {
  const vocabulary = ['ready', 'degraded', 'error', 'info', 'success']

  it('accepts every state the contract declares', () => {
    const source = [
      '<Notice tone="degraded" />',
      '<Notice tone="info" />',
      '<StatePanel state="error" />',
      '<SidepanelShell status="ready" />'
    ].join('\n')

    expect(validateStateVocabulary(source, vocabulary)).toEqual([])
  })

  it('accepts the two documented property tones', () => {
    const source = [
      '<Badge tone="neutral" />',
      '<Surface tone="subtle" />'
    ].join('\n')

    expect(validateStateVocabulary(source, vocabulary)).toEqual([])
  })

  it('rejects a synonym that is not in the contract', () => {
    const issues = validateStateVocabulary(
      '<Notice tone="warning" />',
      vocabulary
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain(
      '"warning" is not in the closed state vocabulary'
    )
  })

  it('rejects an off-contract state and status alike', () => {
    const source = [
      '<StatePanel state="broken" />',
      '<SidepanelShell status="limited" />'
    ].join('\n')

    expect(validateStateVocabulary(source, vocabulary)).toHaveLength(2)
  })

  it('reads a literal wrapped in braces', () => {
    expect(
      validateStateVocabulary('<Notice tone={"unavailable"} />', vocabulary)
    ).toHaveLength(1)
  })
})
