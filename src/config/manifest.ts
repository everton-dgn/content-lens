import type { UserManifest } from 'wxt'

import { youtubeContentMatches as configuredYouTubeContentMatches } from './adapter-origins'

export const youtubeContentMatches = configuredYouTubeContentMatches
export const chromeMinimumVersion = '149'
export const firefoxMinimumVersion = '151.0'
export const firefoxExtensionId = '{b83fdbe3-ec9c-453e-8a61-72d4cfc6dd4e}'
export const optionalProviderOriginPatterns = [
  'https://*/*',
  'http://*/*'
] as const
export const brandIconPaths = {
  16: 'icon/16.png',
  20: 'icon/20.png',
  24: 'icon/24.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  64: 'icon/64.png',
  128: 'icon/128.png'
} as const

const firefoxOptionalProviderOrigins =
  optionalProviderOriginPatterns as unknown as NonNullable<
    UserManifest['optional_permissions']
  >

export const createManifest = (browser: string): UserManifest => {
  const isFirefox = browser === 'firefox'

  return {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    action: {
      default_icon: brandIconPaths,
      default_title: '__MSG_actionOpen__'
    },
    permissions: isFirefox
      ? ['alarms', 'scripting']
      : ['alarms', 'sidePanel', 'scripting'],
    ...(isFirefox
      ? { optional_permissions: [...firefoxOptionalProviderOrigins] }
      : { optional_host_permissions: [...optionalProviderOriginPatterns] }),
    ...(isFirefox
      ? {
          browser_specific_settings: {
            gecko: {
              data_collection_permissions: {
                required: ['none'],
                optional: ['authenticationInfo', 'websiteContent']
              },
              id: firefoxExtensionId,
              strict_min_version: firefoxMinimumVersion
            }
          }
        }
      : { minimum_chrome_version: chromeMinimumVersion })
  }
}
