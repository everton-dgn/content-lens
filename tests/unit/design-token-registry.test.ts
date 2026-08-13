import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DESIGN_SYSTEM_VERSION } from '@/ui/styles/tokens/contract'
import { designTokenRegistry } from '@/ui/styles/tokens/registry'

const tokenNamePattern = /--cl-[a-z0-9-]+(?=\s*:)/gu

async function cssTokenNames() {
  const contents = await Promise.all(
    ['primitives.css', 'semantic.css'].map(file =>
      readFile(resolve('src', 'ui', 'styles', 'tokens', file), 'utf8')
    )
  )
  return [
    ...new Set(
      contents.flatMap(content => content.match(tokenNamePattern) ?? [])
    )
  ].sort()
}

describe('design token registry', () => {
  it('documents every CSS token exactly once', async () => {
    expect(Object.keys(designTokenRegistry).sort()).toEqual(
      await cssTokenNames()
    )
  })

  it('requires typed lifecycle metadata for every token', () => {
    for (const [name, token] of Object.entries(designTokenRegistry)) {
      expect(token.name).toBe(name)
      expect(token.description.trim().length).toBeGreaterThan(20)
      expect(token.version).toBe(DESIGN_SYSTEM_VERSION)
      expect(token.modes.length).toBeGreaterThan(0)
      expect(token.deprecated).toBe(false)
      expect([
        'color',
        'dimension',
        'duration',
        'fontFamily',
        'fontWeight',
        'number',
        'shadow',
        'string'
      ]).toContain(token.type)
    }
  })

  it('marks primitive tokens as mode-independent and semantic tokens as themed', () => {
    for (const token of Object.values(designTokenRegistry)) {
      expect(token.modes).toEqual(
        token.layer === 'primitive' ? ['all'] : ['light', 'dark']
      )
    }
  })
})
