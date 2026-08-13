import { describe, expect, it } from 'vitest'

import { fingerprintPortableValue } from '@/core/operations/fingerprint'

describe('portable fingerprints', () => {
  it('uses one canonical order for distinct Unicode keys', async () => {
    const forward = { 'a\u00adb': 2, ab: 1 }
    const reverse = { ab: 1, 'a\u00adb': 2 }

    expect(await fingerprintPortableValue(forward)).toBe(
      await fingerprintPortableValue(reverse)
    )
  })

  it('treats explicitly undefined object fields as omitted', async () => {
    expect(
      await fingerprintPortableValue({ id: 'rule:1', displayName: undefined })
    ).toBe(await fingerprintPortableValue({ id: 'rule:1' }))
  })
})
