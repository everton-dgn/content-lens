import { describe, expect, it } from 'vitest'

import {
  ADAPTER_CAPABILITY_IDS,
  ADAPTER_CONTRACT_VERSION,
  type AdapterDescriptor,
  type AdapterRouteMatch
} from '@/adapters/contracts'
import { validateAdapterDescriptor } from '@/adapters/registry/validation'

const youtubeOrigin = 'https://www.youtube.com'

const minimalDescriptor = (): AdapterDescriptor => ({
  platform: 'youtube',
  contractVersion: ADAPTER_CONTRACT_VERSION,
  origins: [youtubeOrigin],
  surfaces: ['youtube:home'],
  relations: ['repost'],
  traits: ['promoted'],
  extractableFields: ['title'],
  visualActions: ['show'],
  permissionRequirements: [],
  testedBrowsers: [{ browser: 'chrome', minimumVersion: '149' }],
  lastLiveSmokeAt: null,
  capabilities: Object.fromEntries(
    ADAPTER_CAPABILITY_IDS.map(id => [
      id,
      { state: 'supported', code: `${id}-ok` }
    ])
  ) as AdapterDescriptor['capabilities'],
  spaEvents: ['yt-navigate-finish'],
  matchLocation: (): AdapterRouteMatch => ({
    state: 'unsupported',
    code: 'origin-mismatch'
  }),
  create: () => ({
    disconnect() {},
    restoreAll: () => 0
  })
})

describe('adapter descriptor validation', () => {
  it('rejects a platform outside the contract', () => {
    expect(() =>
      validateAdapterDescriptor({
        ...minimalDescriptor(),
        platform: 'tiktok' as AdapterDescriptor['platform']
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid-platform' }))
  })

  it('rejects an empty origin list and an empty surface list', () => {
    expect(() =>
      validateAdapterDescriptor({ ...minimalDescriptor(), origins: [] })
    ).toThrowError(expect.objectContaining({ code: 'invalid-origin' }))
    expect(() =>
      validateAdapterDescriptor({ ...minimalDescriptor(), surfaces: [] })
    ).toThrowError(expect.objectContaining({ code: 'invalid-surface' }))
  })

  it('rejects unknown surfaces, relations, traits, fields and actions', () => {
    const cases: Array<[Partial<AdapterDescriptor>, string]> = [
      [{ surfaces: ['youtube:searchs' as never] }, 'invalid-surface'],
      [{ relations: ['unknown-kind' as never] }, 'invalid-relation'],
      [{ traits: ['unknown-trait' as never] }, 'invalid-trait'],
      [
        { extractableFields: ['unknown-field' as never] },
        'invalid-extractable-field'
      ],
      [{ visualActions: ['unknown-action' as never] }, 'invalid-visual-action']
    ]

    for (const [overrides, code] of cases) {
      expect(() =>
        validateAdapterDescriptor({ ...minimalDescriptor(), ...overrides })
      ).toThrowError(expect.objectContaining({ code }))
    }
  })

  it('rejects permission requirements that lie about host, flag or origin', () => {
    const cases: Array<[Partial<AdapterDescriptor>, string]> = [
      [
        {
          permissionRequirements: [
            {
              kind: 'native-messaging' as never,
              origin: youtubeOrigin,
              optional: true
            }
          ]
        },
        'invalid-permission'
      ],
      [
        {
          permissionRequirements: [
            { kind: 'host', origin: youtubeOrigin, optional: 'yes' as never }
          ]
        },
        'invalid-permission'
      ],
      [
        {
          permissionRequirements: [
            {
              kind: 'host',
              origin: 'https://elsewhere.example',
              optional: true
            }
          ]
        },
        'invalid-permission'
      ]
    ]

    for (const [overrides, code] of cases) {
      expect(() =>
        validateAdapterDescriptor({ ...minimalDescriptor(), ...overrides })
      ).toThrowError(expect.objectContaining({ code }))
    }
  })

  it('rejects unknown browsers and empty minimum versions', () => {
    expect(() =>
      validateAdapterDescriptor({
        ...minimalDescriptor(),
        testedBrowsers: [{ browser: 'safari' as never, minimumVersion: '18' }]
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid-browser' }))
    expect(() =>
      validateAdapterDescriptor({
        ...minimalDescriptor(),
        testedBrowsers: [{ browser: 'chrome', minimumVersion: '  ' }]
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid-browser' }))
  })

  it('rejects an unparseable live smoke timestamp', () => {
    expect(() =>
      validateAdapterDescriptor({
        ...minimalDescriptor(),
        lastLiveSmokeAt: 'not a date'
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid-live-smoke-date' }))
  })

  it('rejects unsafe diagnostic codes and SPA event names', () => {
    const invalidCode = {
      ...minimalDescriptor(),
      capabilities: {
        ...minimalDescriptor().capabilities,
        'observe-candidates': { state: 'supported' as const, code: 'UPPER' }
      }
    }

    expect(() => validateAdapterDescriptor(invalidCode)).toThrowError(
      expect.objectContaining({ code: 'invalid-diagnostic-code' })
    )
    expect(() =>
      validateAdapterDescriptor({
        ...minimalDescriptor(),
        spaEvents: ['yt-EVENT']
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid-spa-event' }))
  })
})
