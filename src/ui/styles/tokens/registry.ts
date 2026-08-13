import { DESIGN_SYSTEM_VERSION } from './contract.ts'

export const designTokenTypes = [
  'color',
  'dimension',
  'duration',
  'fontFamily',
  'fontWeight',
  'number',
  'shadow',
  'string'
] as const

export type DesignTokenType = (typeof designTokenTypes)[number]
export type DesignTokenMode = 'all' | 'light' | 'dark'
export type DesignTokenLayer = 'primitive' | 'semantic'

export type DesignTokenMetadata = {
  name: `--cl-${string}`
  layer: DesignTokenLayer
  type: DesignTokenType
  description: string
  modes: readonly DesignTokenMode[]
  version: typeof DESIGN_SYSTEM_VERSION
  deprecated:
    | false
    | {
        since: string
        replacement: `--cl-${string}`
      }
}

const primitiveModes = ['all'] as const
const semanticModes = ['light', 'dark'] as const

function entries(
  layer: DesignTokenLayer,
  type: DesignTokenType,
  names: readonly `--cl-${string}`[]
): Array<[`--cl-${string}`, DesignTokenMetadata]> {
  return names.map(name => [
    name,
    {
      name,
      layer,
      type,
      description:
        layer === 'primitive'
          ? `Primitive ${type} value for ${name}; consume it through a semantic alias or system component.`
          : `Semantic ${type} alias for ${name}; use it wherever this interface meaning applies.`,
      modes: layer === 'primitive' ? primitiveModes : semanticModes,
      version: DESIGN_SYSTEM_VERSION,
      deprecated: false
    }
  ])
}

const primitiveColors = [
  '--cl-color-white',
  '--cl-color-ink-950',
  '--cl-color-slate-50',
  '--cl-color-slate-100',
  '--cl-color-slate-200',
  '--cl-color-slate-600',
  '--cl-color-slate-700',
  '--cl-color-slate-900',
  '--cl-color-red-300',
  '--cl-color-brand-navy',
  '--cl-color-red-400',
  '--cl-color-red-700',
  '--cl-color-red-800',
  '--cl-color-amber-300',
  '--cl-color-amber-700',
  '--cl-color-amber-900',
  '--cl-color-teal-300',
  '--cl-color-teal-700',
  '--cl-color-teal-900',
  '--cl-color-night-500',
  '--cl-color-night-700',
  '--cl-color-night-800',
  '--cl-color-night-900',
  '--cl-color-night-950',
  '--cl-color-mist-100',
  '--cl-color-mist-300'
] as const

const primitiveDimensions = [
  '--cl-font-size-xs',
  '--cl-font-size-sm',
  '--cl-font-size-md',
  '--cl-font-size-section',
  '--cl-font-size-lg',
  '--cl-font-size-page',
  '--cl-font-size-display',
  '--cl-letter-spacing-tight',
  '--cl-letter-spacing-wide',
  '--cl-space-0',
  '--cl-space-1',
  '--cl-space-2',
  '--cl-space-3',
  '--cl-space-4',
  '--cl-space-5',
  '--cl-space-6',
  '--cl-space-8',
  '--cl-space-10',
  '--cl-space-12',
  '--cl-radius-sm',
  '--cl-radius-md',
  '--cl-radius-lg',
  '--cl-radius-round',
  '--cl-border-width',
  '--cl-border-width-strong',
  '--cl-gate-width',
  '--cl-focus-width',
  '--cl-focus-offset',
  '--cl-control-min-block',
  '--cl-brand-mark-size',
  '--cl-lens-size',
  '--cl-status-marker-size',
  '--cl-status-beam-inline',
  '--cl-brand-min-inline',
  '--cl-panel-content-max-inline',
  '--cl-options-content-max-inline',
  '--cl-form-max-inline',
  '--cl-choice-min-inline',
  '--cl-rule-card-min-inline'
] as const

const semanticColors = [
  '--cl-color-canvas',
  '--cl-color-topbar',
  '--cl-color-surface',
  '--cl-color-surface-subtle',
  '--cl-color-surface-preview',
  '--cl-color-navigation-surface',
  '--cl-color-surface-hover',
  '--cl-color-text',
  '--cl-color-text-muted',
  '--cl-color-text-subtle',
  '--cl-color-border',
  '--cl-color-control-border',
  '--cl-color-border-strong',
  '--cl-color-action',
  '--cl-color-action-hover',
  '--cl-color-action-text',
  '--cl-color-action-quiet',
  '--cl-color-focus',
  '--cl-color-brand-frame',
  '--cl-color-brand-decision',
  '--cl-color-brand-signal',
  '--cl-color-empty',
  '--cl-color-empty-surface',
  '--cl-color-ready',
  '--cl-color-ready-surface',
  '--cl-color-loading',
  '--cl-color-loading-surface',
  '--cl-color-degraded',
  '--cl-color-degraded-surface',
  '--cl-color-offline',
  '--cl-color-offline-surface',
  '--cl-color-error',
  '--cl-color-error-surface'
] as const

export const designTokenRegistry = Object.fromEntries([
  ...entries('primitive', 'string', ['--cl-ds-version']),
  ...entries('primitive', 'color', primitiveColors),
  ...entries('primitive', 'fontFamily', ['--cl-font-ui', '--cl-font-mono']),
  ...entries('primitive', 'dimension', primitiveDimensions),
  ...entries('primitive', 'fontWeight', [
    '--cl-font-weight-regular',
    '--cl-font-weight-medium',
    '--cl-font-weight-semibold',
    '--cl-font-weight-bold'
  ]),
  ...entries('primitive', 'number', [
    '--cl-line-height-tight',
    '--cl-line-height-normal',
    '--cl-line-height-relaxed',
    '--cl-opacity-disabled'
  ]),
  ...entries('primitive', 'shadow', ['--cl-shadow-soft', '--cl-shadow-deep']),
  ...entries('primitive', 'duration', [
    '--cl-motion-fast',
    '--cl-motion-normal',
    '--cl-motion-calibration'
  ]),
  ...entries('semantic', 'color', semanticColors),
  ...entries('semantic', 'shadow', [
    '--cl-shadow-raised',
    '--cl-shadow-overlay'
  ])
]) as Readonly<Record<`--cl-${string}`, DesignTokenMetadata>>
