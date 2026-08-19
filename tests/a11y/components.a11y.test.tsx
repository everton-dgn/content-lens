// biome-ignore-all lint/performance/noJsxPropsBind: static markup snapshots need no stable handler identity.
import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  Button,
  ChoiceGroup,
  DataList,
  Dialog,
  SectionNav,
  StatusRail
} from '@/ui/components'
import { panelStatuses } from '@/ui/styles/tokens/contract'

const parse = (markup: string) =>
  new DOMParser().parseFromString(markup, 'text/html')

describe('dialog accessibility', () => {
  it('exposes a labelled dialog landmark with a described purpose', () => {
    const cancelRef = createRef<HTMLButtonElement>()
    const page = parse(
      renderToStaticMarkup(
        <Dialog
          cancelRef={cancelRef}
          description="Local data is removed from this browser profile."
          onDismiss={() => undefined}
          title="Review local data reset"
        >
          <Button ref={cancelRef} variant="quiet">
            Cancel
          </Button>
          <Button variant="danger">Reset local data</Button>
        </Dialog>
      )
    )

    const dialog = page.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()

    const labelId = dialog?.getAttribute('aria-labelledby')
    const descriptionId = dialog?.getAttribute('aria-describedby')
    expect(labelId).toBeTruthy()
    expect(descriptionId).toBeTruthy()
    expect(page.getElementById(labelId ?? '')?.textContent).toBe(
      'Review local data reset'
    )
    expect(page.getElementById(descriptionId ?? '')?.textContent).toBe(
      'Local data is removed from this browser profile.'
    )
  })

  it('keeps exactly one danger action beside a cancel control', () => {
    const cancelRef = createRef<HTMLButtonElement>()
    const page = parse(
      renderToStaticMarkup(
        <Dialog
          cancelRef={cancelRef}
          description="Diagnostics are cleared from this device."
          onDismiss={() => undefined}
          title="Clear diagnostics"
        >
          <Button ref={cancelRef} variant="quiet">
            Cancel
          </Button>
          <Button variant="danger">Clear diagnostics</Button>
        </Dialog>
      )
    )

    const dangerActions = page.querySelectorAll('[data-variant="danger"]')
    const primaryActions = page.querySelectorAll('[data-variant="primary"]')
    expect(dangerActions).toHaveLength(1)
    expect(primaryActions).toHaveLength(0)
  })
})

describe('section navigation accessibility', () => {
  it('marks one current destination inside a labelled landmark', () => {
    const page = parse(
      renderToStaticMarkup(
        <SectionNav
          ariaLabel="Settings sections"
          items={[
            { label: 'General', value: 'general' },
            { label: 'Platforms', value: 'platforms' },
            { label: 'Diagnostics', value: 'diagnostics' }
          ]}
          onChange={() => undefined}
          value="platforms"
          variant="compact"
        />
      )
    )

    const nav = page.querySelector('nav')
    expect(nav?.getAttribute('aria-label')).toBe('Settings sections')

    const current = page.querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toBe('Platforms')
  })

  it('renders every destination as an ordinary button, never a tab', () => {
    const page = parse(
      renderToStaticMarkup(
        <SectionNav
          ariaLabel="Panel sections"
          items={[
            { label: 'Home', value: 'home' },
            { label: 'Rules', value: 'rules' }
          ]}
          onChange={() => undefined}
          value="home"
          variant="compact"
        />
      )
    )

    expect(page.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect(page.querySelectorAll('[role="tablist"]')).toHaveLength(0)
    expect(page.querySelectorAll('nav button')).toHaveLength(2)
    expect(page.querySelector('nav')?.getAttribute('data-variant')).toBe(
      'compact'
    )
  })
})

describe('data list accessibility', () => {
  it('pairs every term with one description in source order', () => {
    const page = parse(
      renderToStaticMarkup(
        <DataList
          items={[
            { description: 'Local', term: 'Execution' },
            { description: 'Not reported', term: 'Last verification' },
            { description: '0', term: 'Models in catalog' }
          ]}
          layout="summary"
        />
      )
    )

    const list = page.querySelector('dl')
    expect(list).not.toBeNull()
    expect(list?.getAttribute('data-layout')).toBe('summary')

    const terms = Array.from(
      page.querySelectorAll('dt'),
      node => node.textContent
    )
    const descriptions = Array.from(
      page.querySelectorAll('dd'),
      node => node.textContent
    )

    expect(terms).toEqual([
      'Execution',
      'Last verification',
      'Models in catalog'
    ])
    expect(descriptions).toHaveLength(terms.length)
    expect(descriptions[0]).toBe('Local')
  })
})

describe('choice group accessibility', () => {
  it('links every radio to its visible label and description', () => {
    const page = parse(
      renderToStaticMarkup(
        <ChoiceGroup
          label="What should happen?"
          name="rule-effect"
          onChange={() => undefined}
          options={[
            {
              description:
                'Hide matching titles with a reversible placeholder.',
              label: 'Block',
              value: 'block'
            },
            {
              description: 'Keep matching titles visible.',
              label: 'Allow',
              value: 'allow'
            }
          ]}
          value="block"
        />
      )
    )

    expect(page.querySelector('legend')?.textContent).toBe(
      'What should happen?'
    )

    const radios = Array.from(page.querySelectorAll('[role="radio"]'))
    expect(radios).toHaveLength(2)
    const group = page.querySelector('[role="radiogroup"]')
    expect(group).not.toBeNull()
    const checked = radios.filter(
      radio => radio.getAttribute('aria-checked') === 'true'
    )
    expect(checked).toHaveLength(1)
    for (const radio of radios) {
      const labelId = radio.getAttribute('aria-labelledby')
      const descriptionId = radio.getAttribute('aria-describedby')
      expect(labelId).toBeTruthy()
      expect(descriptionId).toBeTruthy()
      expect(page.getElementById(labelId ?? '')?.textContent).toMatch(
        /^(Block|Allow)$/u
      )
      expect(page.getElementById(descriptionId ?? '')?.textContent).toBeTruthy()
    }
    const nativeRadios = Array.from(
      page.querySelectorAll('input[type="radio"]')
    )
    expect(nativeRadios).toHaveLength(radios.length)
    expect(
      nativeRadios.map(input => input.getAttribute('value')).sort()
    ).toEqual(['allow', 'block'])
    expect(page.querySelector('label.cl-choice-group__option')).toBeNull()
  })
})

describe('status rail accessibility', () => {
  it('keeps the marker and label adjacent for every declared status', () => {
    for (const status of panelStatuses) {
      const page = parse(
        renderToStaticMarkup(<StatusRail label={status} status={status} />)
      )

      const rail = page.querySelector('[data-slot="status-rail"]')
      expect(rail?.getAttribute('data-status'), status).toBe(status)
      expect(rail?.getAttribute('role'), status).toBe('status')

      const children = rail ? Array.from(rail.children) : []
      expect(children, status).toHaveLength(2)
      expect(children[0]?.className, status).toContain('marker')
      expect(children[1]?.textContent, status).toBe(status)
    }
  })

  it('hides the decorative marker from assistive technology', () => {
    const page = parse(
      renderToStaticMarkup(<StatusRail label="Ready" status="ready" />)
    )

    const rail = page.querySelector('[data-slot="status-rail"]')
    const marker = rail?.children[0]

    expect(marker?.getAttribute('aria-hidden')).toBe('true')
    expect(rail?.querySelector('p')?.getAttribute('aria-hidden')).toBeNull()
  })
})
