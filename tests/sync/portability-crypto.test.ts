import { describe, expect, it } from 'vitest'

import { sealSyncEnvelope } from '@/sync/canonical'
import { emptySyncProfile } from '@/sync/contracts'
import {
  decryptPortableEnvelope,
  encryptPortableEnvelope
} from '@/sync/portability-crypto'

async function envelope() {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:portable',
    generation: 0,
    profile: {
      ...emptySyncProfile(),
      exclusions: [{ id: 'exclusion:one', value: { topic: 'spoilers' } }]
    },
    tombstones: []
  })
}

describe('encrypted profile portability', () => {
  it('round-trips with the required KDF, cipher and random envelope values', async () => {
    const source = await envelope()
    const first = await encryptPortableEnvelope(
      source,
      'correct horse battery staple'
    )
    const second = await encryptPortableEnvelope(
      source,
      'correct horse battery staple'
    )

    expect(first).toMatchObject({
      format: 'content-lens-portability',
      version: 1,
      encryption: 'aes-256-gcm',
      syncProfileId: 'sync:portable',
      generation: 0,
      kdf: {
        algorithm: 'PBKDF2-HMAC-SHA-256',
        iterations: 600_000
      },
      cipher: {
        algorithm: 'AES-256-GCM',
        tagBits: 128
      }
    })
    expect(first.kdf.salt).not.toBe(second.kdf.salt)
    expect(first.cipher.iv).not.toBe(second.cipher.iv)
    await expect(
      decryptPortableEnvelope(first, 'correct horse battery staple')
    ).resolves.toEqual({ state: 'decrypted', envelope: source })
  })

  it('uses one non-sensitive failure for a wrong passphrase or tampering', async () => {
    const encrypted = await encryptPortableEnvelope(
      await envelope(),
      'correct horse battery staple'
    )
    const wrongPassphrase = await decryptPortableEnvelope(
      encrypted,
      'incorrect horse battery staple'
    )
    const tamperedPayload = `${encrypted.payload.slice(0, -2)}AA`
    const tampered = await decryptPortableEnvelope(
      { ...encrypted, payload: tamperedPayload },
      'correct horse battery staple'
    )

    expect(wrongPassphrase).toEqual({
      state: 'failed',
      code: 'portability-decryption-failed'
    })
    expect(tampered).toEqual(wrongPassphrase)

    const tamperedMetadata = await decryptPortableEnvelope(
      { ...encrypted, generation: 1 },
      'correct horse battery staple'
    )
    expect(tamperedMetadata).toEqual(wrongPassphrase)

    const tamperedManifest = await decryptPortableEnvelope(
      {
        ...encrypted,
        manifest: {
          ...encrypted.manifest,
          counts: { ...encrypted.manifest.counts, exclusions: 99 }
        }
      },
      'correct horse battery staple'
    )
    expect(tamperedManifest).toEqual(wrongPassphrase)
    // Three key derivations at the documented iteration count. Well under a
    // second on its own, but the coverage instrumentation multiplies it far
    // enough to pass the default timeout.
  }, 30_000)

  it('rejects passphrases outside the documented UTF-8 byte limits', async () => {
    await expect(
      encryptPortableEnvelope(await envelope(), 'short')
    ).rejects.toThrow(RangeError)
    await expect(
      encryptPortableEnvelope(await envelope(), 'x'.repeat(1_025))
    ).rejects.toThrow(RangeError)
  })
})
