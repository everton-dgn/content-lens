import { describe, expect, it } from 'vitest'

import {
  brandIconPaths,
  chromeMinimumVersion,
  createManifest,
  firefoxExtensionId,
  firefoxMinimumVersion,
  youtubeContentMatches
} from './manifest'

describe('createManifest', () => {
  it('declares only the Chrome side panel permission', () => {
    const manifest = createManifest('chrome')

    expect(manifest).toMatchObject({
      action: {
        default_icon: brandIconPaths,
        default_title: '__MSG_actionOpen__'
      },
      default_locale: 'en',
      description: '__MSG_extensionDescription__',
      name: '__MSG_extensionName__'
    })
    expect(manifest.permissions).toEqual(['alarms', 'sidePanel', 'scripting'])
    expect(manifest.optional_host_permissions).toEqual([
      'https://*/*',
      'http://*/*'
    ])
    expect(manifest.optional_permissions ?? []).toEqual([])
    expect(manifest.minimum_chrome_version).toBe(chromeMinimumVersion)
    expect(manifest.browser_specific_settings).toBeUndefined()
  })

  it('pins the Firefox identity and minimum version, requests no API permissions, and declares no data collection', () => {
    const manifest = createManifest('firefox')

    expect(manifest.permissions).toEqual(['alarms', 'scripting'])
    expect(manifest.optional_permissions).toEqual(['https://*/*', 'http://*/*'])
    expect(manifest.optional_host_permissions ?? []).toEqual([])
    expect(manifest.minimum_chrome_version).toBeUndefined()
    expect(manifest.browser_specific_settings?.gecko).toMatchObject({
      id: firefoxExtensionId,
      strict_min_version: firefoxMinimumVersion
    })
    expect(
      manifest.browser_specific_settings?.gecko?.data_collection_permissions
    ).toEqual({
      required: ['none'],
      optional: ['authenticationInfo', 'websiteContent']
    })
  })

  it('keeps the exact YouTube match available to runtime registration', () => {
    expect(youtubeContentMatches).toEqual(['https://www.youtube.com/*'])
  })
})
