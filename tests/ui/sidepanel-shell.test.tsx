import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  BackAction,
  Badge,
  Button,
  Disclosure,
  Field,
  FileField,
  Notice,
  Progress,
  SecretField,
  SelectField,
  SettingRow,
  SidepanelShell,
  StatePanel,
  Surface,
  SwitchField,
  ToggleField
} from '@/ui/components'
import { viewStates } from '@/ui/styles/tokens/contract'

function render(markup: ReactNode) {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(markup),
    'text/html'
  )
}

const noChange = () => undefined

describe('sidepanel shell', () => {
  it('renders one compact quiet back action with a directional icon', () => {
    const page = render(<BackAction label="Back to settings" />)
    const action = page.querySelector('[data-slot="back-action"]')

    expect(action?.getAttribute('data-size')).toBe('compact')
    expect(action?.getAttribute('data-variant')).toBe('quiet')
    expect(action?.textContent).toBe('Back to settings')
    expect(action?.querySelectorAll('svg')).toHaveLength(1)
    expect(action?.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true'
    )
  })

  it('renders one product landmark and a labeled non-color status', () => {
    const page = render(
      <SidepanelShell
        footer="Local processing"
        productName="ContentLens"
        status="ready"
        statusLabel="Local engine ready"
      >
        <StatePanel
          description="No rules yet"
          eyebrow="No rules"
          state="empty"
          title="Create a rule"
        />
      </SidepanelShell>
    )

    expect(page.querySelectorAll('h1')).toHaveLength(1)
    expect(page.querySelectorAll('main')).toHaveLength(1)
    expect(page.querySelector('[data-status="ready"]')?.textContent).toBe(
      'Local engine ready'
    )
    expect(page.querySelector('[data-status="ready"] svg')).not.toBeNull()
    expect(page.querySelector('[data-slot="sidepanel-shell"]')).not.toBeNull()
  })

  it('reserves a navigation row only for the shell that carries one', () => {
    const withNavigation = render(
      <SidepanelShell
        footer="Local processing"
        navigation={<nav>Sections</nav>}
        productName="ContentLens"
        status="ready"
        statusLabel="Local engine ready"
      >
        <p>Panel body</p>
      </SidepanelShell>
    )
    const withoutNavigation = render(
      <SidepanelShell
        footer="Local processing"
        productName="ContentLens"
        status="ready"
        statusLabel="Local engine ready"
      >
        <p>Panel body</p>
      </SidepanelShell>
    )
    const shellOf = (page: Document) =>
      page.querySelector('[data-slot="sidepanel-shell"]')

    // The scroll area sizes itself against this modifier, so a shell without
    // navigation must not keep the class or an empty row behind it.
    expect(shellOf(withNavigation)?.getAttribute('class')).toBe(
      'cl-shell cl-shell--with-navigation'
    )
    expect(
      withNavigation.querySelector('.cl-shell__navigation')?.textContent
    ).toBe('Sections')
    expect(shellOf(withoutNavigation)?.getAttribute('class')).toBe('cl-shell')
    expect(withoutNavigation.querySelector('.cl-shell__navigation')).toBeNull()
  })

  it.each(viewStates)('renders the %s view state contract', state => {
    const page = render(
      <StatePanel
        description={`${state} description`}
        eyebrow="State"
        state={state}
        title={`${state} title`}
      />
    )

    const panel = page.querySelector('[data-slot="state-panel"]')
    expect(panel?.getAttribute('data-state')).toBe(state)
    expect(panel?.textContent).toContain(`${state} title`)
  })

  it('offers one typed primary action slot', () => {
    const page = render(
      <StatePanel
        description="Preview before save"
        eyebrow="First rule"
        primaryAction={<Button size="full">Preview rule</Button>}
        state="empty"
        title="Create a rule"
      />
    )

    expect(
      page.querySelectorAll(
        '[data-slot="state-panel"] [data-slot="button"][data-variant="primary"]'
      )
    ).toHaveLength(1)
  })

  it('links field help and errors to the input', () => {
    const page = render(
      <Field
        error="Use at least two characters"
        hint="Match a channel name"
        label="Source"
      />
    )

    const input = page.querySelector('input')
    const inputId = input?.getAttribute('id')
    expect(input?.getAttribute('aria-describedby')).toBe(
      `${inputId}-hint ${inputId}-error`
    )
    expect(input?.getAttribute('aria-invalid')).toBe('true')
    expect(page.querySelector(`label[for="${inputId}"]`)).not.toBeNull()
  })

  it('owns every visible label in the local file picker', () => {
    const page = render(
      <FileField
        actionLabel="Choose JSON file"
        emptyLabel="No file selected"
        hint="Validated before replacement"
        label="Import portable profile"
      />
    )

    const input = page.querySelector('input[type="file"]')
    const labelIds = input?.getAttribute('aria-labelledby')?.split(' ') ?? []
    expect(
      labelIds
        .map(labelId => page.getElementById(labelId)?.textContent)
        .join(' ')
    ).toBe('Choose JSON file Import portable profile')
    expect(page.body.textContent).toContain('Choose JSON file')
    expect(page.body.textContent).toContain('No file selected')
  })

  it('links select help and errors to one native selector', () => {
    const page = render(
      <SelectField
        error="Choose an available model"
        hint="Provider and model stay visible"
        label="Text model"
        options={[{ label: 'Disabled', value: 'disabled' }]}
      />
    )
    const select = page.querySelector('[data-slot="select-field"] select[id]')
    const id = select?.getAttribute('id')
    expect(select?.getAttribute('aria-describedby')).toBe(
      `${id}-hint ${id}-error`
    )
    expect(page.querySelector(`label[for="${id}"]`)).not.toBeNull()
  })

  it('keeps secret reveal transient and labels independent toggles', () => {
    const page = render(
      <>
        <SecretField
          hideLabel="Hide"
          label="API key"
          onChange={noChange}
          revealLabel="Reveal"
          value="transient"
        />
        <ToggleField
          checked
          description="Allows image input"
          label="Vision"
          onChange={noChange}
        />
      </>
    )
    const secret = page.querySelector('input[type="password"]')
    expect(secret).not.toBeNull()
    expect(page.querySelector('[aria-pressed="false"]')?.textContent).toBe(
      'Reveal'
    )
    const toggle = page.querySelector('input[type="checkbox"]')
    expect(toggle?.hasAttribute('checked')).toBe(true)
    expect(page.querySelector(`label[for="${toggle?.id}"]`)).not.toBeNull()
  })

  it('keeps component tones and slots explicit', () => {
    const page = render(
      <Surface elevation="raised">
        <Badge tone="success">Verified</Badge>
        <Notice body="Stored locally" title="Saved" tone="success" />
      </Surface>
    )

    expect(page.querySelector('[data-slot="surface"]')).not.toBeNull()
    expect(page.querySelector('[data-tone="success"]')).not.toBeNull()
    expect(page.querySelector('[role="status"]')).not.toBeNull()
    expect(page.querySelector('.cl-notice__mark svg')).not.toBeNull()
  })

  it('exposes switch, disclosure, progress and setting row semantics', () => {
    const page = render(
      <>
        <SwitchField
          checked
          description="Applies after saving"
          label="Advanced mode"
          onChange={noChange}
        />
        <Disclosure defaultOpen summary="Resource limits">
          <p>Maximum input bytes</p>
        </Disclosure>
        <Progress
          description="Stored locally"
          label="Model download"
          max={100}
          value={40}
          valueLabel="40%"
        />
        <SettingRow
          control={<Button variant="secondary">Review</Button>}
          description="One current value"
          title="Provider"
        />
      </>
    )

    const switchControl = page.querySelector('[role="switch"]')
    expect(switchControl?.getAttribute('aria-checked')).toBe('true')
    const switchLabelId = switchControl?.getAttribute('aria-labelledby') ?? ''
    expect(page.getElementById(switchLabelId)?.textContent).toBe(
      'Advanced mode'
    )
    const disclosure = page.querySelector('[data-slot="disclosure"]')
    expect(
      disclosure
        ?.querySelector('.cl-disclosure__trigger')
        ?.getAttribute('aria-expanded')
    ).toBe('true')
    expect(disclosure?.textContent).toContain('Resource limits')
    const progress = page.querySelector('progress')
    expect(progress?.getAttribute('value')).toBe('40')
    expect(
      page.getElementById(progress?.getAttribute('aria-labelledby') ?? '')
        ?.textContent
    ).toBe('Model download')
    expect(
      page.querySelector('[data-slot="setting-row"]')?.textContent
    ).toContain('One current value')
  })
})
