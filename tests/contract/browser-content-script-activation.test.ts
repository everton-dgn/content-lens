import { describe, expect, it } from 'vitest'

import {
  BrowserContentScriptActivation,
  type BrowserScriptingApi,
  PLATFORM_CONTENT_SCRIPT_FILE
} from '@/application/adapter-activation/browser-content-scripts'
import type { BrowserPermissionsApi } from '@/application/provider-management/browser-permissions'

function permissionApi(granted: string[] = []): {
  api: BrowserPermissionsApi
  granted: Set<string>
  requests: string[][]
  removals: string[][]
} {
  const current = new Set(granted)
  const requests: string[][] = []
  const removals: string[][] = []
  return {
    granted: current,
    requests,
    removals,
    api: {
      contains: async ({ origins = [] }) =>
        origins.every(origin => current.has(origin)),
      getAll: async () => ({ origins: [...current] }),
      request: async ({ origins = [] }) => {
        requests.push(origins)
        for (const origin of origins) {
          current.add(origin)
        }
        return true
      },
      remove: async ({ origins = [] }) => {
        removals.push(origins)
        for (const origin of origins) {
          current.delete(origin)
        }
        return true
      }
    }
  }
}

function scriptingApi(): {
  api: BrowserScriptingApi
  registrations: Map<
    string,
    Parameters<BrowserScriptingApi['registerContentScripts']>[0][number]
  >
  registered: string[]
  unregistered: string[]
} {
  const registrations = new Map<
    string,
    Parameters<BrowserScriptingApi['registerContentScripts']>[0][number]
  >()
  const registered: string[] = []
  const unregistered: string[] = []
  return {
    registrations,
    registered,
    unregistered,
    api: {
      getRegisteredContentScripts: async ({ ids } = {}) =>
        [...registrations.values()].filter(
          ({ id }) => !ids || ids.includes(id)
        ),
      registerContentScripts: async scripts => {
        for (const script of scripts) {
          registrations.set(script.id, structuredClone(script))
          registered.push(script.id)
        }
      },
      unregisterContentScripts: async ({ ids } = {}) => {
        for (const id of ids ?? [...registrations.keys()]) {
          registrations.delete(id)
          unregistered.push(id)
        }
      }
    }
  }
}

describe('browser content-script activation', () => {
  it('requests one exact platform origin only inside an explicit user action', async () => {
    const permissions = permissionApi()
    const scripting = scriptingApi()
    const activation = new BrowserContentScriptActivation({
      permissions: permissions.api,
      scripting: scripting.api
    })

    await expect(
      activation.requestEnable('reddit', { userInitiated: false })
    ).rejects.toThrow('adapter-permission-user-gesture-required')
    expect(permissions.requests).toEqual([])

    await expect(
      activation.requestEnable('reddit', { userInitiated: true })
    ).resolves.toEqual({
      state: 'active',
      platform: 'reddit',
      origins: ['https://www.reddit.com/*']
    })
    expect(permissions.requests).toEqual([['https://www.reddit.com/*']])
    expect([...scripting.registrations.values()]).toEqual([
      {
        allFrames: false,
        id: 'contentlens-platform-reddit-v1',
        js: [PLATFORM_CONTENT_SCRIPT_FILE],
        matches: ['https://www.reddit.com/*'],
        persistAcrossSessions: true,
        runAt: 'document_idle'
      }
    ])
  })

  it('does not request or register a page script for RSS', async () => {
    const permissions = permissionApi()
    const scripting = scriptingApi()
    const activation = new BrowserContentScriptActivation({
      permissions: permissions.api,
      scripting: scripting.api
    })

    await expect(
      activation.requestEnable('rss', { userInitiated: true })
    ).resolves.toEqual({
      state: 'inactive',
      platform: 'rss',
      code: 'platform-has-no-content-script'
    })
    expect(permissions.requests).toEqual([])
    expect(scripting.registrations.size).toBe(0)
  })

  it('reconciles enabled settings with current grants without prompting', async () => {
    const permissions = permissionApi([
      'https://www.youtube.com/*',
      'https://x.com/*'
    ])
    const scripting = scriptingApi()
    const activation = new BrowserContentScriptActivation({
      permissions: permissions.api,
      scripting: scripting.api
    })

    await activation.reconcile(['youtube', 'reddit'])

    expect(permissions.requests).toEqual([])
    expect([...scripting.registrations.keys()]).toEqual([
      'contentlens-platform-youtube-v1'
    ])
  })

  it('removes stale registrations and optionally revokes the exact grant', async () => {
    const permissions = permissionApi(['https://x.com/*'])
    const scripting = scriptingApi()
    const activation = new BrowserContentScriptActivation({
      permissions: permissions.api,
      scripting: scripting.api
    })
    await activation.reconcile(['x'])

    await activation.disable('x', { removePermission: true })

    expect(scripting.registrations.size).toBe(0)
    expect(scripting.unregistered).toEqual(['contentlens-platform-x-v1'])
    expect(permissions.removals).toEqual([['https://x.com/*']])
    expect(permissions.granted.size).toBe(0)
  })

  it('replaces a stale registration instead of widening its matches', async () => {
    const permissions = permissionApi(['https://www.linkedin.com/*'])
    const scripting = scriptingApi()
    scripting.registrations.set('contentlens-platform-linkedin-v1', {
      id: 'contentlens-platform-linkedin-v1',
      js: ['content-scripts/old.js'],
      matches: ['https://*/*']
    })
    const activation = new BrowserContentScriptActivation({
      permissions: permissions.api,
      scripting: scripting.api
    })

    await activation.reconcile(['linkedin'])

    expect(scripting.unregistered).toEqual(['contentlens-platform-linkedin-v1'])
    expect(
      scripting.registrations.get('contentlens-platform-linkedin-v1')
    ).toMatchObject({
      js: [PLATFORM_CONTENT_SCRIPT_FILE],
      matches: ['https://www.linkedin.com/*']
    })
  })

  it('contains a registration failure to one platform during reconciliation', async () => {
    const permissions = permissionApi([
      'https://www.linkedin.com/*',
      'https://x.com/*'
    ])
    const scripting = scriptingApi()
    const getRegisteredContentScripts =
      scripting.api.getRegisteredContentScripts
    scripting.api.getRegisteredContentScripts = async filter => {
      if (filter?.ids?.includes('contentlens-platform-linkedin-v1')) {
        throw new Error('synthetic-registration-failure')
      }
      return getRegisteredContentScripts(filter)
    }
    const activation = new BrowserContentScriptActivation({
      permissions: permissions.api,
      scripting: scripting.api
    })

    const results = await activation.reconcile(['linkedin', 'x'])

    expect(results).toContainEqual({
      state: 'inactive',
      platform: 'linkedin',
      code: 'registration-failed'
    })
    expect(results).toContainEqual({
      state: 'active',
      platform: 'x',
      origins: ['https://x.com/*']
    })
    expect([...scripting.registrations.keys()]).toEqual([
      'contentlens-platform-x-v1'
    ])
  })
})
