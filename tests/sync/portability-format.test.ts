import { describe, expect, it } from 'vitest'

import { sealSyncEnvelope } from '@/sync/canonical'
import { emptySyncProfile } from '@/sync/contracts'
import {
  MAX_PORTABILITY_FILE_BYTES,
  parsePortabilityFile,
  serializeEncryptedPortabilityFile,
  serializePlaintextPortabilityFile
} from '@/sync/portability-format'

const at = '2026-07-31T12:00:00.000Z'

async function envelope() {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:portable',
    generation: 2,
    profile: {
      ...emptySyncProfile(),
      exclusions: [{ id: 'exclusion:one', value: { topic: 'spoilers' } }]
    },
    tombstones: []
  })
}

describe('manual portability file format', () => {
  it('round-trips a validated plaintext manifest with exact counts', async () => {
    const source = await envelope()
    const raw = await serializePlaintextPortabilityFile(source, at)
    const file = JSON.parse(raw) as Record<string, unknown>

    expect(file).toMatchObject({
      format: 'content-lens-portability',
      version: 1,
      encryption: 'none',
      syncProfileId: 'sync:portable',
      generation: 2,
      manifest: {
        createdAt: at,
        counts: { exclusions: 1, rules: 0 },
        digest: source.digest
      }
    })
    expect(JSON.stringify(file)).toContain('credentials')
    await expect(parsePortabilityFile(raw)).resolves.toEqual({
      state: 'ready',
      encrypted: false,
      envelope: source
    })
  })

  it('requires a passphrase without exposing why decryption failed', async () => {
    const raw = await serializeEncryptedPortabilityFile(
      await envelope(),
      'correct horse battery staple',
      at
    )

    await expect(parsePortabilityFile(raw)).resolves.toEqual({
      state: 'passphrase-required'
    })
    await expect(
      parsePortabilityFile(raw, 'incorrect horse battery staple')
    ).resolves.toEqual({
      state: 'invalid',
      code: 'portability-decryption-failed'
    })
  })

  it('rejects oversized input before JSON parsing', async () => {
    const oversized = 'x'.repeat(MAX_PORTABILITY_FILE_BYTES + 1)
    await expect(parsePortabilityFile(oversized)).resolves.toEqual({
      state: 'invalid',
      code: 'portability-file-too-large'
    })
  })

  it('rejects sensitive field names even inside generic portable values', async () => {
    await expect(
      sealSyncEnvelope({
        schemaVersion: 1,
        syncProfileId: 'sync:portable',
        generation: 0,
        profile: {
          ...emptySyncProfile(),
          exclusions: [
            { id: 'exclusion:unsafe', value: { access_token: 'canary' } }
          ]
        },
        tombstones: []
      })
    ).rejects.toThrow('Sensitive fields are forbidden')
  })
})
