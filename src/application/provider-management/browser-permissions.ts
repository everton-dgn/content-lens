import { normalizeEndpointOrigin } from '@/ai/providers/contracts'

export const FIREFOX_PROVIDER_DATA_COLLECTION = [
  'authenticationInfo',
  'websiteContent'
] as const

type ProviderDataCollection = (typeof FIREFOX_PROVIDER_DATA_COLLECTION)[number]

type PermissionRequest = {
  origins?: string[]
  permissions?: string[]
  data_collection?: ProviderDataCollection[]
}

export type BrowserPermissionsApi = {
  contains(request: PermissionRequest): Promise<boolean>
  getAll(): Promise<PermissionRequest>
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

function normalizeDataCollection(
  input: readonly ProviderDataCollection[]
): ProviderDataCollection[] {
  const selected = new Set(input)
  return FIREFOX_PROVIDER_DATA_COLLECTION.filter(category =>
    selected.has(category)
  )
}

export class BrowserPermissionPort {
  readonly #api: BrowserPermissionsApi
  readonly #browser: 'chrome' | 'firefox'

  constructor(options: {
    api: BrowserPermissionsApi
    browser: 'chrome' | 'firefox'
  }) {
    this.#api = options.api
    this.#browser = options.browser
  }

  async has(
    binding: ProviderOriginBinding,
    dataCollection: readonly ProviderDataCollection[] = []
  ) {
    const origin = normalizeEndpointOrigin(
      binding.endpointOrigin,
      binding.execution
    )
    const hasOrigin = await this.#api.contains({
      origins: [exactOriginPattern(origin)]
    })
    if (!hasOrigin || this.#browser !== 'firefox') {
      return hasOrigin
    }
    const required = normalizeDataCollection(dataCollection)
    if (required.length === 0) {
      return true
    }
    const granted = new Set((await this.#api.getAll()).data_collection ?? [])
    return required.every(category => granted.has(category))
  }

  async request(
    binding: ProviderOriginBinding,
    options: {
      userInitiated: boolean
      dataCollection: readonly ProviderDataCollection[]
    }
  ) {
    if (!options.userInitiated) {
      throw new Error('provider-permission-user-gesture-required')
    }
    const origin = normalizeEndpointOrigin(
      binding.endpointOrigin,
      binding.execution
    )
    const dataCollection = normalizeDataCollection(options.dataCollection)
    return this.#api.request({
      origins: [exactOriginPattern(origin)],
      ...(this.#browser === 'firefox' && dataCollection.length > 0
        ? { data_collection: dataCollection }
        : {})
    })
  }

  async remove(origin: string) {
    return this.#api.remove({
      origins: [exactOriginPattern(origin)]
    })
  }
}
