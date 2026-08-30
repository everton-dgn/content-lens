import { normalizeEndpointOrigin } from '@/ai/providers/contracts'

type PermissionRequest = {
  origins?: string[]
  permissions?: string[]
}

export type BrowserPermissionsApi = {
  contains(request: PermissionRequest): Promise<boolean>
  remove(request: PermissionRequest): Promise<boolean>
  request(request: PermissionRequest): Promise<boolean>
}

type ProviderOriginBinding = {
  endpointOrigin: string
  execution: 'local' | 'cloud' | 'browser'
}

function exactOriginPattern(origin: string) {
  const url = new URL(origin)
  if (
    url.origin !== origin ||
    (url.protocol !== 'https:' && url.protocol !== 'http:')
  ) {
    throw new TypeError('Invalid provider permission origin')
  }
  return `${url.origin}/*`
}

export class BrowserPermissionPort {
  readonly #api: BrowserPermissionsApi

  constructor(options: { api: BrowserPermissionsApi }) {
    this.#api = options.api
  }

  async has(binding: ProviderOriginBinding) {
    const origin = normalizeEndpointOrigin(
      binding.endpointOrigin,
      binding.execution
    )
    return this.#api.contains({
      origins: [exactOriginPattern(origin)]
    })
  }

  async request(
    binding: ProviderOriginBinding,
    options: {
      userInitiated: boolean
    }
  ) {
    if (!options.userInitiated) {
      throw new Error('provider-permission-user-gesture-required')
    }
    const origin = normalizeEndpointOrigin(
      binding.endpointOrigin,
      binding.execution
    )
    return this.#api.request({
      origins: [exactOriginPattern(origin)]
    })
  }

  async remove(origin: string) {
    return this.#api.remove({
      origins: [exactOriginPattern(origin)]
    })
  }
}
