import type { UserManifest } from 'wxt'

import { youtubeContentMatches as configuredYouTubeContentMatches } from './adapter-origins'

export const youtubeContentMatches = configuredYouTubeContentMatches
export const chromeMinimumVersion = '149'
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

export const createManifest = (): UserManifest => ({
  name: '__MSG_extensionName__',
  description: '__MSG_extensionDescription__',
  default_locale: 'en',
  action: {
    default_icon: brandIconPaths,
    default_title: '__MSG_actionOpen__'
  },
  permissions: ['alarms', 'sidePanel', 'scripting'],
  optional_host_permissions: [...optionalProviderOriginPatterns],
  minimum_chrome_version: chromeMinimumVersion
})
