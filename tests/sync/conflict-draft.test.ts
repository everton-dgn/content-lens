import { describe, expect, it } from 'vitest'

import { sealSyncEnvelope } from '@/sync/canonical'
import {
  createSyncConflictDraft,
  validateSyncConflictDraft
} from '@/sync/conflict-draft'
import { emptySyncProfile } from '@/sync/contracts'

const at = '2026-07-31T12:00:00.000Z'

async function envelope(value: number) {
  return sealSyncEnvelope({
    schemaVersion: 1,
    syncProfileId: 'sync:conflict-draft',
    generation: 0,
    profile: {
      ...emptySyncProfile(),
      exclusions: [{ id: 'same', value: { value } }]
    },
    tombstones: []
  })
}

describe('durable sync conflict drafts', () => {
  it('recomputes the merge and preserves valid partial resolutions', async () => {
    const draft = await createSyncConflictDraft({
      base: await envelope(1),
      local: await envelope(2),
      remote: await envelope(3),
      remoteVersionToken: '"version:one"',
      at
    })
    draft.resolutions = [
      {
        entityType: 'exclusions',
        entityId: 'same',
        choice: 'local'
      }
    ]

    await expect(validateSyncConflictDraft(draft)).resolves.toMatchObject({
      id: 'sync-conflict:sync:conflict-draft',
      resolutions: [{ choice: 'local' }]
    })
  })

  it('rejects tampered envelopes, control characters and unknown resolutions', async () => {
    const draft = await createSyncConflictDraft({
      base: await envelope(1),
      local: await envelope(2),
      remote: await envelope(3),
      remoteVersionToken: '"version:one"',
      at
    })
    await expect(
      validateSyncConflictDraft({
        ...draft,
        local: { ...draft.local, digest: '0'.repeat(64) }
      })
    ).resolves.toBeUndefined()
    await expect(
      validateSyncConflictDraft({
        ...draft,
        remoteVersionToken: '"version"\r\ninjected: true'
      })
    ).resolves.toBeUndefined()
    await expect(
      validateSyncConflictDraft({
        ...draft,
        resolutions: [
          { entityType: 'rules', entityId: 'missing', choice: 'remote' }
        ]
      })
    ).resolves.toBeUndefined()
  })
})
