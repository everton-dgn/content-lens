import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Button, SidepanelShell, StatePanel } from '@/ui/components'

function colorValue(stylesheet: string, token: string) {
  const match = stylesheet.match(
    new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'iu')
  )
  if (!match?.[1]) {
    throw new Error(`Color token ${token} was not found`)
  }
  return match[1]
}

function channelsOf(color: string) {
  const channels = color
    .slice(1)
    .match(/.{2}/gu)
    ?.map(channel => Number.parseInt(channel, 16))
  if (channels?.length !== 3) {
    throw new Error(`Color ${color} is not a six-digit hex value`)
  }
  return channels
}

function mixSrgb(foreground: string, percent: number, background: string) {
  const front = channelsOf(foreground)
  const back = channelsOf(background)
  const blended = front.map((value, index) =>
    Math.round((value * percent + (back[index] ?? 0) * (100 - percent)) / 100)
  )
  return `#${blended.map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function controlBorderMix(stylesheet: string) {
  const lightMode = stylesheet.slice(
    stylesheet.indexOf(":root[data-theme='light']")
  )
  const match = lightMode.match(
    /--cl-color-control-border:\s*color-mix\(\s*in srgb,\s*var\((--cl-color-[a-z0-9-]+)\)\s*(\d+)%/u
  )
  if (!match?.[1] || !match[2]) {
    throw new Error('The control border mix was not found')
  }
  return {
    foregroundToken: match[1],
    percent: Number.parseInt(match[2], 10)
  }
}

function relativeLuminance(color: string) {
  const channels = color
    .slice(1)
    .match(/.{2}/gu)
    ?.map(channel => Number.parseInt(channel, 16) / 255)
  if (channels?.length !== 3) {
    throw new Error(`Color ${color} is not a six-digit hex value`)
  }
  const [red = 0, green = 0, blue = 0] = channels.map(channel =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground: string, background: string) {
  const values = [
    relativeLuminance(foreground),
    relativeLuminance(background)
  ].sort((left, right) => right - left)
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05)
}

describe('sidepanel shell accessibility', () => {
  it('keeps headings, landmarks and the primary action operable', () => {
    const page = new DOMParser().parseFromString(
      renderToStaticMarkup(
        <SidepanelShell
          footer="Local processing"
          productName="ContentLens"
          status="degraded"
          statusLabel="Degraded"
        >
          <StatePanel
            description="The deterministic baseline is still available."
            eyebrow="Capability"
            primaryAction={<Button>Review limitation</Button>}
            state="degraded"
            title="One capability is unavailable"
          />
        </SidepanelShell>
      ),
      'text/html'
    )

    const headings = [...page.querySelectorAll('h1, h2')].map(
      heading => heading.tagName
    )
    const button = page.querySelector('button')

    expect(headings).toEqual(['H1', 'H2'])
    expect(page.querySelectorAll('main')).toHaveLength(1)
    const status = page.querySelector('[data-status="degraded"]')
    expect(status?.textContent).toContain('Degraded')
    expect(status?.getAttribute('role')).toBe('status')
    expect(
      status
        ?.querySelector('.cl-status-rail__label')
        ?.hasAttribute('aria-hidden')
    ).toBe(false)
    expect(button?.type).toBe('button')
    button?.focus()
    expect(page.activeElement).toBe(button)
  })

  it('announces pending, success and error semantics', () => {
    const cases = [
      { state: 'loading', role: 'status', busy: 'true' },
      { state: 'success', role: 'status', busy: null },
      { state: 'error', role: 'alert', busy: null }
    ] as const

    for (const item of cases) {
      const page = new DOMParser().parseFromString(
        renderToStaticMarkup(
          <StatePanel
            description="Description"
            eyebrow="State"
            state={item.state}
            title="Title"
          />
        ),
        'text/html'
      )
      const panel = page.querySelector('[data-slot="state-panel"]')
      expect(panel?.getAttribute('role')).toBe(item.role)
      expect(panel?.getAttribute('aria-busy')).toBe(item.busy)
    }
  })

  it('defines zoom-safe controls, compact reflow and motion fallbacks', async () => {
    const [tokens, components, globals] = await Promise.all([
      readFile(resolve('src/ui/styles/tokens/primitives.css'), 'utf8'),
      readFile(resolve('src/ui/styles/components.css'), 'utf8'),
      readFile(resolve('src/ui/styles/globals.css'), 'utf8')
    ])

    expect(tokens).toContain('--cl-control-min-block: 2.75rem')
    expect(components).toContain('@media (width > 24rem)')
    expect(globals).toContain('@media (prefers-reduced-motion: reduce)')
    expect(globals).toContain('@media (forced-colors: active)')
  })

  it('keeps focal surfaces neutral and repeated toggles as hairline rows', async () => {
    const [components, globals] = await Promise.all([
      readFile(resolve('src/ui/styles/components.css'), 'utf8'),
      readFile(resolve('src/ui/styles/globals.css'), 'utf8')
    ])
    const raisedSurface = components.match(
      /\.cl-surface\[data-elevation=["']raised["']\]\s*\{([^}]*)\}/u
    )?.[1]
    const toggleField = components.match(
      /\.cl-toggle-field\s*\{([^}]*)\}/u
    )?.[1]

    expect(raisedSurface).toBeDefined()
    expect(raisedSurface).not.toContain('border-inline-start')
    expect(toggleField).toContain(
      'border-block-start: var(--cl-border-width) solid var(--cl-color-border)'
    )
    expect(toggleField).toContain('border-radius: var(--cl-space-0)')
    expect(globals).toContain('font-family: var(--cl-font-mono)')
  })

  it('keeps light-theme text pairs above the WCAG AA contrast floor', async () => {
    const tokens = await readFile(
      resolve('src/ui/styles/tokens/primitives.css'),
      'utf8'
    )
    const color = (token: string) => colorValue(tokens, token)
    const blend = (token: string, percent: number, base: string) =>
      mixSrgb(color(token), percent, color(base))
    const navigationSurface = mixSrgb(
      color('--cl-color-white'),
      94,
      color('--cl-color-slate-50')
    )
    const activeNavigationSurface = mixSrgb(
      color('--cl-color-red-700'),
      5,
      navigationSurface
    )
    const activeNavigationText = mixSrgb(
      color('--cl-color-red-700'),
      84,
      color('--cl-color-slate-900')
    )
    const activeCompactNavigationSurface = mixSrgb(
      color('--cl-color-red-700'),
      8,
      color('--cl-color-slate-50')
    )

    const pairs: ReadonlyArray<readonly [string, string, string]> = [
      [
        'text on canvas',
        color('--cl-color-slate-900'),
        color('--cl-color-slate-50')
      ],
      [
        'muted text on canvas',
        color('--cl-color-slate-700'),
        color('--cl-color-slate-50')
      ],
      [
        'text on surface',
        color('--cl-color-slate-900'),
        color('--cl-color-white')
      ],
      [
        'action text on action',
        color('--cl-color-white'),
        color('--cl-color-red-700')
      ],
      [
        'action on canvas',
        color('--cl-color-red-700'),
        color('--cl-color-slate-50')
      ],
      [
        'active navigation text on active surface',
        activeNavigationText,
        activeNavigationSurface
      ],
      [
        'active navigation text on compact surface',
        activeNavigationText,
        activeCompactNavigationSurface
      ],
      [
        'ready on ready surface',
        color('--cl-color-teal-700'),
        blend('--cl-color-teal-700', 8, '--cl-color-white')
      ],
      [
        'degraded on degraded surface',
        color('--cl-color-amber-700'),
        blend('--cl-color-amber-700', 7, '--cl-color-white')
      ],
      [
        'error on error surface',
        color('--cl-color-red-800'),
        blend('--cl-color-red-700', 8, '--cl-color-white')
      ],
      [
        'offline on subtle surface',
        color('--cl-color-slate-700'),
        blend('--cl-color-slate-100', 72, '--cl-color-white')
      ]
    ]

    for (const [label, foreground, background] of pairs) {
      expect(
        contrastRatio(foreground, background),
        label
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps dark-theme text pairs above the WCAG AA contrast floor', async () => {
    const tokens = await readFile(
      resolve('src/ui/styles/tokens/primitives.css'),
      'utf8'
    )
    const color = (token: string) => colorValue(tokens, token)

    const pairs: ReadonlyArray<readonly [string, string, string]> = [
      [
        'text on surface',
        color('--cl-color-mist-100'),
        color('--cl-color-night-900')
      ],
      [
        'muted text on surface',
        color('--cl-color-mist-300'),
        color('--cl-color-night-900')
      ],
      [
        'text on canvas',
        color('--cl-color-mist-100'),
        color('--cl-color-night-950')
      ],
      [
        'action text on action',
        color('--cl-color-night-950'),
        color('--cl-color-red-400')
      ],
      [
        'action on canvas',
        color('--cl-color-red-400'),
        color('--cl-color-night-950')
      ],
      [
        'ready on ready surface',
        color('--cl-color-teal-300'),
        color('--cl-color-teal-900')
      ],
      [
        'degraded on degraded surface',
        color('--cl-color-amber-300'),
        color('--cl-color-amber-900')
      ],
      [
        'muted text on subtle surface',
        color('--cl-color-mist-300'),
        color('--cl-color-night-800')
      ]
    ]

    for (const [label, foreground, background] of pairs) {
      expect(
        contrastRatio(foreground, background),
        label
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps control and focus graphics above the non-text contrast floor', async () => {
    const primitives = await readFile(
      resolve('src/ui/styles/tokens/primitives.css'),
      'utf8'
    )
    const semantic = await readFile(
      resolve('src/ui/styles/tokens/semantic.css'),
      'utf8'
    )
    const color = (token: string) => colorValue(primitives, token)
    const borderMix = controlBorderMix(semantic)
    const controlBorder = mixSrgb(
      color(borderMix.foregroundToken),
      borderMix.percent,
      color('--cl-color-white')
    )

    const pairs: ReadonlyArray<readonly [string, string, string]> = [
      ['control border on surface', controlBorder, color('--cl-color-white')],
      ['control border on canvas', controlBorder, color('--cl-color-slate-50')],
      [
        'focus on surface',
        color('--cl-color-red-700'),
        color('--cl-color-white')
      ],
      [
        'dark control border on surface',
        color('--cl-color-night-500'),
        color('--cl-color-night-900')
      ],
      [
        'dark focus on surface',
        color('--cl-color-red-400'),
        color('--cl-color-night-900')
      ]
    ]

    for (const [label, foreground, background] of pairs) {
      expect(
        contrastRatio(foreground, background),
        label
      ).toBeGreaterThanOrEqual(3)
    }
  })
})
