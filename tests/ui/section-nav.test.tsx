import { Home, ShieldCheck } from 'lucide-react'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SectionNav } from '@/ui/components'

const mounted: Array<{ container: HTMLDivElement; root: Root }> = []

async function mount(node: ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  await act(async () => root.render(node))
  return container
}

const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
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

describe('section navigation', () => {
  it('reports the destination behind the pressed button', async () => {
    const onChange = vi.fn()
    const container = await mount(
      <SectionNav
        ariaLabel="Sections"
        items={[
          { label: 'Home', value: 'home' },
          { label: 'Rules', value: 'rules' }
        ]}
        onChange={onChange}
        value="home"
        variant="primary"
      />
    )
    const buttons = [...container.querySelectorAll('button')]

    await click(buttons[1] as Element)

    expect(onChange).toHaveBeenCalledExactlyOnceWith('rules')
  })

  it('stays quiet for an entry that carries no destination', async () => {
    const onChange = vi.fn()
    const container = await mount(
      <SectionNav
        ariaLabel="Sections"
        items={[{ label: 'Placeholder', value: '' }]}
        onChange={onChange}
        value="home"
        variant="compact"
      />
    )
    const button = container.querySelector('button')

    expect(button?.dataset.value).toBe('')
    await click(button as Element)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('marks the current destination and carries the requested variant', async () => {
    const container = await mount(
      <SectionNav
        ariaLabel="Sections"
        items={[
          { label: 'Home', value: 'home' },
          { label: 'Rules', value: 'rules' }
        ]}
        onChange={vi.fn()}
        value="rules"
        variant="compact"
      />
    )
    const nav = container.querySelector('[data-slot="section-nav"]')
    const current = container.querySelectorAll('[aria-current="page"]')

    expect(nav?.getAttribute('data-variant')).toBe('compact')
    expect(nav?.getAttribute('aria-label')).toBe('Sections')
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toBe('Rules')
  })

  it('renders an icon only for the entries that declare one', async () => {
    const container = await mount(
      <SectionNav
        ariaLabel="Sections"
        items={[
          { icon: Home, label: 'Home', value: 'home' },
          { label: 'Rules', value: 'rules' },
          { icon: ShieldCheck, label: 'Review', value: 'review' }
        ]}
        onChange={vi.fn()}
        value="home"
        variant="primary"
      />
    )
    const buttons = [...container.querySelectorAll('button')]

    expect(buttons[0]?.querySelectorAll('svg')).toHaveLength(1)
    expect(buttons[1]?.querySelectorAll('svg')).toHaveLength(0)
    expect(buttons[2]?.querySelectorAll('svg')).toHaveLength(1)
  })
})
