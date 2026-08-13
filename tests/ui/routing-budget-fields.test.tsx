import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_BUDGET_POLICY } from '@/ai/models/contracts'
import type { SettingsPanelCopy } from '@/ui/settings/copy'
import { RoutingBudgetFields } from '@/ui/settings/RoutingBudgetFields'

const copy = new Proxy(
  { hoursLabel: (hours: number) => `${hours} hours` },
  {
    get: (target, key) =>
      key in target ? target[key as keyof typeof target] : String(key)
  }
) as SettingsPanelCopy

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function change(
  control: HTMLInputElement | HTMLSelectElement,
  value: string
) {
  const prototype =
    control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  await act(async () => {
    setter?.call(control, value)
    control.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is missing`)
  return value
}

describe('routing budget fields', () => {
  it('updates each request and concurrency limit', async () => {
    const onChange = vi.fn()
    await act(async () =>
      root.render(
        <RoutingBudgetFields
          copy={copy}
          onChange={onChange}
          value={DEFAULT_BUDGET_POLICY}
        />
      )
    )
    const selects = [...container.querySelectorAll('select')]
    await change(required(selects[0], 'global concurrency'), '8')
    await change(required(selects[1], 'provider concurrency'), '4')
    await change(required(selects[2], 'minute request limit'), '300')
    await change(required(selects[3], 'daily request limit'), '10000')
    expect(onChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ maxConcurrentGlobal: 8 })
    )
    expect(onChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ maxConcurrentByProvider: 4 })
    )
    expect(onChange).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ requestsPerMinuteByProvider: 300 })
    )
    expect(onChange).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ requestsPerDayByProvider: 10_000 })
    )
  })

  it('enables and edits the monetary budget without accepting NaN', async () => {
    const onChange = vi.fn()
    const value = {
      ...DEFAULT_BUDGET_POLICY,
      monetaryBudget: {
        ...DEFAULT_BUDGET_POLICY.monetaryBudget,
        enabled: true
      }
    }
    await act(async () =>
      root.render(
        <RoutingBudgetFields copy={copy} onChange={onChange} value={value} />
      )
    )
    const inputs = [...container.querySelectorAll('input')]
    const budgetSwitch = required(
      container.querySelector<HTMLButtonElement>('[role="switch"]') ??
        undefined,
      'budget switch'
    )
    await act(async () => budgetSwitch.click())
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        monetaryBudget: expect.objectContaining({ enabled: false })
      })
    )

    const amount = required(
      inputs.find(input => input.type === 'number'),
      'budget amount'
    )
    const currency = required(
      inputs.find(input => input.type === 'text'),
      'budget currency'
    )
    await change(amount, '12.5')
    await change(currency, 'brl')
    const selects = [...container.querySelectorAll('select')]
    await change(required(selects.at(-1), 'price age'), '48')
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        monetaryBudget: expect.objectContaining({ limit: 12.5 })
      })
    )
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        monetaryBudget: expect.objectContaining({ currency: 'BRL' })
      })
    )
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        monetaryBudget: expect.objectContaining({ priceMaxAgeHours: 48 })
      })
    )

    const beforeInvalid = onChange.mock.calls.length
    await change(amount, '')
    expect(onChange).toHaveBeenCalledTimes(beforeInvalid)
  })
})
