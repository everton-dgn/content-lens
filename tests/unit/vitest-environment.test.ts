import { readFile } from 'node:fs/promises'

import { act } from 'react'
import { describe, expect, it } from 'vitest'

describe('Vitest environment contract', () => {
  it('loads Node built-ins and React test APIs in test mode', async () => {
    expect(process.env.NODE_ENV).toBe('test')
    expect(typeof act).toBe('function')
    expect(await readFile('package.json', 'utf8')).toContain(
      '"name": "content-lens"'
    )
  })
})
