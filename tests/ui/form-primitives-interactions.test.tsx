import { act, type ChangeEvent, type ReactNode, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  Button,
  Combobox,
  Dialog,
  SecretField,
  SwitchField,
  TextareaField,
  ToggleField
} from '@/ui/components'

const mounted: Array<{ container: HTMLDivElement; root: Root }> = []

async function mount(node: ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  await act(async () => root.render(node))
  return container
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  while (mounted.length > 0) {
    const view = mounted.pop()
    if (view) {
      await act(async () => view.root.unmount())
      view.container.remove()
    }
  }
})

describe('form primitive interactions', () => {
  it('opens the combobox with arrows and selects the active option', async () => {
    const selectedValues: string[] = []
    const onChange = vi.fn((event: ChangeEvent<HTMLSelectElement>) => {
      selectedValues.push(event.currentTarget.value)
    })
    const container = await mount(
      <Combobox
        label="Model"
        onChange={onChange}
        options={[
          { label: 'Compact', value: 'compact' },
          { disabled: true, label: 'Unavailable', value: 'unavailable' },
          { label: 'Precise', value: 'precise' }
        ]}
        searchLabel="Search models"
        value="compact"
      />
    )
    const trigger =
      container.querySelector<HTMLButtonElement>('[role="combobox"]')
    expect(trigger?.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger?.getAttribute('aria-controls')).toBeTruthy()

    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })
      )
      await Promise.resolve()
    })

    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')
    const search = document.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )
    expect(listbox?.id).toBe(trigger?.getAttribute('aria-controls'))
    expect(document.activeElement).toBe(search)
    expect(search?.getAttribute('aria-controls')).toBe(listbox?.id)
    expect(document.querySelectorAll('.cl-combobox__indicator')).toHaveLength(1)
    expect(
      document
        .querySelector('[role="option"][aria-selected="true"]')
        ?.querySelector('.cl-combobox__indicator')
    ).not.toBeNull()

    await act(async () => {
      search?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })
      )
    })
    const activeId = search?.getAttribute('aria-activedescendant')
    expect(activeId).toBeTruthy()
    expect(document.getElementById(activeId ?? '')?.textContent).toContain(
      'Precise'
    )

    await act(async () => {
      search?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })
      )
    })
    expect(onChange).toHaveBeenCalledOnce()
    expect(selectedValues).toEqual(['precise'])
  })

  it('filters the combobox and supports Home, End and Escape', async () => {
    const container = await mount(
      <Combobox
        label="Model"
        onChange={vi.fn()}
        options={[
          { label: 'Compact', value: 'compact' },
          { label: 'Balanced', value: 'balanced' },
          { label: 'Precise', value: 'precise' }
        ]}
        searchLabel="Search models"
        value="balanced"
      />
    )
    const trigger =
      container.querySelector<HTMLButtonElement>('[role="combobox"]')

    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'End' })
      )
      await Promise.resolve()
    })
    const search = document.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )
    expect(
      document.getElementById(
        search?.getAttribute('aria-activedescendant') ?? ''
      )?.textContent
    ).toContain('Precise')

    await act(async () => {
      search?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Home' })
      )
    })
    expect(
      document.getElementById(
        search?.getAttribute('aria-activedescendant') ?? ''
      )?.textContent
    ).toContain('Compact')

    if (search) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      await act(async () => {
        setter?.call(search, 'prec')
        search.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    const visibleOptions = document.querySelectorAll('[role="option"]')
    expect(visibleOptions).toHaveLength(2)
    expect(visibleOptions[0]?.textContent).toContain('Balanced')
    expect(visibleOptions[1]?.textContent).toContain('Precise')
    expect(
      document.getElementById(
        search?.getAttribute('aria-activedescendant') ?? ''
      )?.textContent
    ).toContain('Precise')

    if (search) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      await act(async () => {
        setter?.call(search, '')
        search.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    expect(
      document.getElementById(
        search?.getAttribute('aria-activedescendant') ?? ''
      )?.textContent
    ).toContain('Balanced')

    await act(async () => {
      search?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })
      )
    })
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')
  })

  it('leaves the active descendant unset when every option is disabled', async () => {
    const container = await mount(
      <Combobox
        label="Model"
        onChange={vi.fn()}
        options={[
          { disabled: true, label: 'Unavailable', value: 'unavailable' }
        ]}
        searchLabel="Search models"
        value="unavailable"
      />
    )
    const trigger =
      container.querySelector<HTMLButtonElement>('[role="combobox"]')

    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })
      )
      await Promise.resolve()
    })
    const search = document.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )
    await act(async () => {
      search?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })
      )
    })
    expect(search?.hasAttribute('aria-activedescendant')).toBe(false)
    expect(
      document.querySelector('[role="option"]')?.getAttribute('aria-disabled')
    ).toBe('true')
  })

  it('dismisses a controlled dialog with Escape', async () => {
    const onDismiss = vi.fn()
    const DialogHarness = () => {
      const [open, setOpen] = useState(true)
      const cancelRef = useRef<HTMLButtonElement>(null)
      return open ? (
        <Dialog
          cancelRef={cancelRef}
          description="Review the local change."
          onDismiss={() => {
            onDismiss()
            setOpen(false)
          }}
          title="Review change"
        >
          <Button ref={cancelRef} variant="quiet">
            Cancel
          </Button>
        </Dialog>
      ) : (
        <p>Closed</p>
      )
    }
    const container = await mount(<DialogHarness />)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })
      )
    })

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain('Closed')
  })

  it('links textarea hints and errors for explicit and generated ids', async () => {
    const explicitId = 'rule-description'
    const container = await mount(
      <>
        <TextareaField
          defaultValue="Draft"
          error="Required"
          hint="Explain your rule"
          id={explicitId}
          label="Description"
        />
        <TextareaField label="Notes" />
      </>
    )
    const [described, plain] = container.querySelectorAll('textarea')
    expect(described?.getAttribute('aria-describedby')).toBe(
      'rule-description-hint rule-description-error'
    )
    expect(described?.getAttribute('aria-invalid')).toBe('true')
    expect(plain?.id).not.toBe('')
    expect(plain?.hasAttribute('aria-describedby')).toBe(false)
    expect(plain?.hasAttribute('aria-invalid')).toBe(false)
  })

  it('reveals, hides and updates a transient secret', async () => {
    const onChange = vi.fn()
    const container = await mount(
      <SecretField
        error="Invalid key"
        hideLabel="Hide"
        hint="Stored in this browser"
        label="API key"
        onChange={onChange}
        revealLabel="Reveal"
        value="secret"
      />
    )
    const input = container.querySelector('input')
    const action = container.querySelector('button')
    expect(input?.type).toBe('password')
    expect(input?.getAttribute('aria-describedby')).toContain('-hint')
    expect(input?.getAttribute('aria-describedby')).toContain('-error')

    await act(async () => action?.click())
    expect(input?.type).toBe('text')
    expect(action?.textContent).toBe('Hide')
    expect(action?.getAttribute('aria-pressed')).toBe('true')
    await act(async () => action?.click())
    expect(input?.type).toBe('password')

    if (input) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      await act(async () => {
        setter?.call(input, 'updated')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    expect(onChange).toHaveBeenCalledWith('updated')
  })

  it('emits boolean changes from switch and toggle controls', async () => {
    const onSwitch = vi.fn()
    const onToggle = vi.fn()
    const container = await mount(
      <>
        <SwitchField
          checked={false}
          description="Applies after save"
          label="Enabled"
          name="enabled"
          onChange={onSwitch}
        />
        <ToggleField
          checked={false}
          description="Allow image input"
          label="Vision"
          name="vision"
          onChange={onToggle}
        />
      </>
    )
    const switchControl =
      container.querySelector<HTMLButtonElement>('[role="switch"]')
    const toggleControl = container.querySelector<HTMLInputElement>(
      '[data-slot="toggle-field"] input'
    )
    await act(async () => switchControl?.click())
    await act(async () => toggleControl?.click())
    expect(onSwitch).toHaveBeenCalledWith(true)
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})
