import { describe, expect, it } from 'vitest'

import {
  type ProposalSuppressionRecord,
  ProposalSuppressionService
} from '@/application/assistance/proposal-suppression'

describe('assistance proposal suppression', () => {
  it('applies a 30-day cooldown and suppresses the third dismissal', async () => {
    const records = new Map<string, ProposalSuppressionRecord>()
    const service = new ProposalSuppressionService({
      read: async fingerprint => records.get(fingerprint),
      write: async record => {
        records.set(record.fingerprint, structuredClone(record))
      }
    })
    const fingerprint = 'sha256:proposal'
    const evidenceVersion = 'evidence@1'
    const firstAt = '2026-01-01T00:00:00.000Z'
    const secondAt = '2026-02-01T00:00:00.000Z'
    const thirdAt = '2026-03-04T00:00:00.000Z'

    await service.dismiss({ fingerprint, evidenceVersion, at: firstAt })
    await expect(
      service.status({
        fingerprint,
        evidenceVersion,
        at: '2026-01-15T00:00:00.000Z'
      })
    ).resolves.toMatchObject({
      state: 'cooldown',
      dismissalCount: 1,
      until: '2026-01-31T00:00:00.000Z'
    })

    await service.dismiss({ fingerprint, evidenceVersion, at: secondAt })
    const third = await service.dismiss({
      fingerprint,
      evidenceVersion,
      at: thirdAt
    })
    expect(third).toMatchObject({
      dismissalCount: 3,
      suppressed: true
    })
    await expect(
      service.status({
        fingerprint,
        evidenceVersion,
        at: '2027-01-01T00:00:00.000Z'
      })
    ).resolves.toEqual({
      state: 'suppressed',
      dismissalCount: 3
    })
  })

  it('resets on a new evidence version or explicit reactivation', async () => {
    const records = new Map<string, ProposalSuppressionRecord>()
    const service = new ProposalSuppressionService({
      read: async fingerprint => records.get(fingerprint),
      write: async record => {
        records.set(record.fingerprint, structuredClone(record))
      }
    })
    const fingerprint = 'sha256:proposal'
    for (const at of [
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-04T00:00:00.000Z'
    ]) {
      await service.dismiss({
        fingerprint,
        evidenceVersion: 'evidence@1',
        at
      })
    }

    await expect(
      service.status({
        fingerprint,
        evidenceVersion: 'evidence@2',
        at: '2026-03-05T00:00:00.000Z'
      })
    ).resolves.toEqual({ state: 'allowed', dismissalCount: 0 })

    await service.reactivate({
      fingerprint,
      evidenceVersion: 'evidence@1',
      at: '2026-03-05T00:00:00.000Z'
    })
    await expect(
      service.status({
        fingerprint,
        evidenceVersion: 'evidence@1',
        at: '2026-03-05T00:00:01.000Z'
      })
    ).resolves.toEqual({ state: 'allowed', dismissalCount: 0 })
  })
})
