import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

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

  it('installs the WXT browser runner used by the dev command', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      devDependencies: Record<string, string>
    }
    const require = createRequire(import.meta.url)

    expect(packageJson.devDependencies['web-ext']).toBe('10.5.0')
    expect(() => require.resolve('web-ext')).not.toThrow()
  })
})
