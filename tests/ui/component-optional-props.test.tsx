// biome-ignore-all lint/performance/noJsxPropsBind: static markup snapshots need no stable handler identity.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FileField, Progress, SettingRow, SwitchField } from '@/ui/components'

const parse = (markup: string) =>
  new DOMParser().parseFromString(markup, 'text/html')

describe('progress', () => {
  it('renders an indeterminate bar when no value is supplied', () => {
    const page = parse(
      renderToStaticMarkup(<Progress label="Rebuilding the index" />)
    )
    const bar = page.querySelector('progress')

    expect(bar).not.toBeNull()
    expect(bar?.hasAttribute('value')).toBe(false)
    expect(bar?.getAttribute('aria-describedby')).toBeNull()
    expect(page.querySelector('strong')).toBeNull()
  })

  it('links its description and shows the value label when both are supplied', () => {
    const page = parse(
      renderToStaticMarkup(
        <Progress
          description="Rebuilds resume after a restart."
          label="Rebuilding the index"
          value={40}
          valueLabel="40%"
        />
      )
    )
    const bar = page.querySelector('progress')
    const describedBy = bar?.getAttribute('aria-describedby')

    expect(bar?.getAttribute('value')).toBe('40')
    expect(describedBy).toBeTruthy()
    expect(page.getElementById(describedBy ?? '')?.textContent).toBe(
      'Rebuilds resume after a restart.'
    )
    expect(page.querySelector('strong')?.textContent).toBe('40%')
  })

  it('keeps the default maximum and accepts an explicit one', () => {
    const byDefault = parse(renderToStaticMarkup(<Progress label="Work" />))
    const explicit = parse(
      renderToStaticMarkup(<Progress label="Work" max={7} />)
    )

    expect(byDefault.querySelector('progress')?.getAttribute('max')).toBe('100')
    expect(explicit.querySelector('progress')?.getAttribute('max')).toBe('7')
  })
})

describe('setting row', () => {
  it('omits the description element when there is no description', () => {
    const page = parse(
      renderToStaticMarkup(
        <SettingRow
          control={<button type="button">Edit</button>}
          title="Theme"
        />
      )
    )

    expect(page.querySelector('strong')?.textContent).toBe('Theme')
    expect(page.querySelector('small')).toBeNull()
    expect(page.querySelector('.cl-setting-row__control button')).not.toBeNull()
  })

  it('renders the description beside the title when one is supplied', () => {
    const page = parse(
      renderToStaticMarkup(
        <SettingRow
          control={<button type="button">Edit</button>}
          description="Applies to this browser profile only."
          title="Theme"
        />
      )
    )

    expect(page.querySelector('small')?.textContent).toBe(
      'Applies to this browser profile only.'
    )
  })
})

describe('switch field', () => {
  it('describes nothing when the switch has no description', () => {
    const page = parse(
      renderToStaticMarkup(
        <SwitchField
          checked={false}
          label="Advanced mode"
          onChange={() => undefined}
        />
      )
    )
    const control = page.querySelector('[role="switch"]')

    expect(control?.getAttribute('aria-describedby')).toBeNull()
    expect(control?.getAttribute('aria-checked')).toBe('false')
    expect(page.querySelector('small')).toBeNull()
  })

  it('links its description and reports the disabled state', () => {
    const page = parse(
      renderToStaticMarkup(
        <SwitchField
          checked
          description="Shows every routing control."
          disabled
          label="Advanced mode"
          onChange={() => undefined}
        />
      )
    )
    const control = page.querySelector('[role="switch"]')
    const describedBy = control?.getAttribute('aria-describedby')

    expect(control?.getAttribute('aria-checked')).toBe('true')
    expect(control?.hasAttribute('disabled')).toBe(true)
    expect(page.getElementById(describedBy ?? '')?.textContent).toBe(
      'Shows every routing control.'
    )
  })
})

describe('file field', () => {
  it('starts on the empty label and describes only its selection', () => {
    const page = parse(
      renderToStaticMarkup(
        <FileField
          actionLabel="Choose JSON file"
          emptyLabel="No file selected"
          label="Import portable profile"
        />
      )
    )
    const input = page.querySelector('input[type="file"]')
    const describedBy = input?.getAttribute('aria-describedby') ?? ''

    expect(page.body.textContent).toContain('No file selected')
    expect(describedBy.split(' ').filter(Boolean)).toHaveLength(1)
  })

  it('adds the hint to the description chain when one is supplied', () => {
    const page = parse(
      renderToStaticMarkup(
        <FileField
          actionLabel="Choose JSON file"
          emptyLabel="No file selected"
          hint="Exports are validated before replacement."
          label="Import portable profile"
        />
      )
    )
    const input = page.querySelector('input[type="file"]')
    const describedBy = input?.getAttribute('aria-describedby') ?? ''
    const ids = describedBy.split(' ').filter(Boolean)

    expect(ids).toHaveLength(2)
    expect(page.getElementById(ids[0] ?? '')?.textContent).toBe(
      'Exports are validated before replacement.'
    )
  })

  it('uses a supplied id instead of the generated one', () => {
    const page = parse(
      renderToStaticMarkup(
        // biome-ignore lint/correctness/useUniqueElementIds: the supplied id is what this case asserts.
        <FileField
          actionLabel="Choose JSON file"
          emptyLabel="No file selected"
          id="portable-import"
          label="Import portable profile"
        />
      )
    )

    expect(page.querySelector('#portable-import')).not.toBeNull()
    expect(page.querySelector('#portable-import-selection')).not.toBeNull()
  })
})
