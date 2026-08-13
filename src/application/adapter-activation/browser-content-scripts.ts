import type { BrowserPermissionsApi } from '@/application/provider-management/browser-permissions'
import { INSTALLED_ADAPTER_ORIGINS } from '@/config/adapter-origins'
import type { Platform } from '@/core/content/contracts'

export const PLATFORM_CONTENT_SCRIPT_FILE = 'content-scripts/content.js'

export const DOM_ADAPTER_PLATFORMS = [
  'youtube',
  'linkedin',
  'x',
  'reddit',
  'hacker-news'
] as const satisfies readonly Platform[]

export type DomAdapterPlatform = (typeof DOM_ADAPTER_PLATFORMS)[number]

type RegisteredContentScript = {
  allFrames?: boolean
  id: string
  js?: string[]
  matches?: string[]
  persistAcrossSessions?: boolean
  runAt?: 'document_start' | 'document_end' | 'document_idle'
}

export type BrowserScriptingApi = {
  getRegisteredContentScripts(filter?: {
    ids?: string[]
  }): Promise<RegisteredContentScript[]>
  registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>
  unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>
}

export type PlatformActivationResult =
  | {
      state: 'active'
      platform: DomAdapterPlatform
      origins: readonly string[]
    }
  | {
      state: 'inactive'
      platform: Platform
      code:
        | 'adapter-disabled'
        | 'host-permission-denied'
        | 'host-permission-missing'
        | 'platform-has-no-content-script'
        | 'registration-failed'
    }

const platformScriptId = (platform: DomAdapterPlatform) =>
  `contentlens-platform-${platform}-v1`

const platformOrigins = (platform: DomAdapterPlatform) =>
  INSTALLED_ADAPTER_ORIGINS.filter(entry => entry.platform === platform).map(
    ({ origin }) => `${origin}/*`
  )

const isDomAdapterPlatform = (
  platform: Platform
): platform is DomAdapterPlatform =>
  DOM_ADAPTER_PLATFORMS.includes(platform as DomAdapterPlatform)

const desiredRegistration = (
  platform: DomAdapterPlatform
): RegisteredContentScript => ({
  allFrames: false,
  id: platformScriptId(platform),
  js: [PLATFORM_CONTENT_SCRIPT_FILE],
  matches: platformOrigins(platform),
  persistAcrossSessions: true,
  runAt: 'document_idle'
})

const sameRegistration = (
  current: RegisteredContentScript,
  desired: RegisteredContentScript
) =>
  current.id === desired.id &&
  current.allFrames === desired.allFrames &&
  current.persistAcrossSessions === desired.persistAcrossSessions &&
  current.runAt === desired.runAt &&
  JSON.stringify(current.js ?? []) === JSON.stringify(desired.js ?? []) &&
  JSON.stringify(current.matches ?? []) ===
    JSON.stringify(desired.matches ?? [])

export class BrowserContentScriptActivation {
  readonly #permissions: BrowserPermissionsApi
  readonly #scripting: BrowserScriptingApi

  constructor(options: {
    permissions: BrowserPermissionsApi
    scripting: BrowserScriptingApi
  }) {
    this.#permissions = options.permissions
    this.#scripting = options.scripting
  }

  async requestEnable(
    platform: Platform,
    options: { userInitiated: boolean }
  ): Promise<PlatformActivationResult> {
    if (!options.userInitiated) {
      throw new Error('adapter-permission-user-gesture-required')
    }
    if (!isDomAdapterPlatform(platform)) {
      return {
        state: 'inactive',
        platform,
        code: 'platform-has-no-content-script'
      }
    }
    const origins = platformOrigins(platform)
    if (!(await this.#permissions.request({ origins }))) {
      await this.#unregister(platform)
      return {
        state: 'inactive',
        platform,
        code: 'host-permission-denied'
      }
    }
    try {
      await this.#ensureRegistered(platform)
    } catch {
      await this.#bestEffortUnregister(platform)
      return {
        state: 'inactive',
        platform,
        code: 'registration-failed'
      }
    }
    return { state: 'active', platform, origins }
  }

  async reconcile(
    enabledPlatforms: readonly Platform[]
  ): Promise<PlatformActivationResult[]> {
    const enabled = new Set(enabledPlatforms)
    const results: PlatformActivationResult[] = []
    for (const platform of DOM_ADAPTER_PLATFORMS) {
      const origins = platformOrigins(platform)
      try {
        const hasPermission = await this.#permissions.contains({ origins })
        if (enabled.has(platform) && hasPermission) {
          await this.#ensureRegistered(platform)
          results.push({ state: 'active', platform, origins })
          continue
        }
        await this.#unregister(platform)
        results.push({
          state: 'inactive',
          platform,
          code: hasPermission ? 'adapter-disabled' : 'host-permission-missing'
        })
      } catch {
        await this.#bestEffortUnregister(platform)
        results.push({
          state: 'inactive',
          platform,
          code: 'registration-failed'
        })
      }
    }
    return results
  }

  async disable(
    platform: Platform,
    options: { removePermission: boolean }
  ): Promise<PlatformActivationResult> {
    if (!isDomAdapterPlatform(platform)) {
      return {
        state: 'inactive',
        platform,
        code: 'platform-has-no-content-script'
      }
    }
    try {
      await this.#unregister(platform)
    } catch {
      return {
        state: 'inactive',
        platform,
        code: 'registration-failed'
      }
    }
    if (options.removePermission) {
      await this.#permissions.remove({ origins: platformOrigins(platform) })
    }
    return {
      state: 'inactive',
      platform,
      code: 'adapter-disabled'
    }
  }

  async #ensureRegistered(platform: DomAdapterPlatform) {
    const desired = desiredRegistration(platform)
    const existing = (
      await this.#scripting.getRegisteredContentScripts({
        ids: [desired.id]
      })
    )[0]
    if (existing && sameRegistration(existing, desired)) {
      return
    }
    if (existing) {
      await this.#scripting.unregisterContentScripts({ ids: [desired.id] })
    }
    await this.#scripting.registerContentScripts([desired])
  }

  async #unregister(platform: DomAdapterPlatform) {
    const id = platformScriptId(platform)
    const existing = await this.#scripting.getRegisteredContentScripts({
      ids: [id]
    })
    if (existing.length > 0) {
      await this.#scripting.unregisterContentScripts({ ids: [id] })
    }
  }

  async #bestEffortUnregister(platform: DomAdapterPlatform) {
    try {
      await this.#unregister(platform)
    } catch {
      // The caller reports registration-failed and keeps the adapter inactive.
    }
  }
}
