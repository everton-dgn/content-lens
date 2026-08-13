import {
  normalizeEndpointOrigin,
  type ProviderConnectionResult,
  type ProviderDescriptor,
  providerConnectionResultSchema,
  providerDescriptorSchema
} from '@/ai/providers/contracts'

export class ProviderRegistry {
  readonly #providers = new Map<string, ProviderDescriptor>()

  constructor(providers: readonly unknown[] = []) {
    for (const provider of providers) {
      this.upsert(provider)
    }
  }

  upsert(input: unknown): ProviderDescriptor {
    const provider = providerDescriptorSchema.parse(input)
    const stored = structuredClone(provider)
    this.#providers.set(provider.providerConfigId, stored)
    return structuredClone(stored)
  }

  get(providerConfigId: string): ProviderDescriptor | undefined {
    const provider = this.#providers.get(providerConfigId)
    return provider ? structuredClone(provider) : undefined
  }

  list(): ProviderDescriptor[] {
    return [...this.#providers.values()]
      .sort((left, right) =>
        left.providerConfigId.localeCompare(right.providerConfigId)
      )
      .map(provider => structuredClone(provider))
  }

  remove(providerConfigId: string): ProviderDescriptor {
    const current = this.#providers.get(providerConfigId)
    if (!current) {
      throw new TypeError('Unknown provider configuration')
    }
    this.#providers.delete(providerConfigId)
    return structuredClone(current)
  }

  fork() {
    return new ProviderRegistry(this.list())
  }

  replaceWith(source: ProviderRegistry) {
    const providers = source.list()
    this.#providers.clear()
    for (const provider of providers) {
      this.#providers.set(provider.providerConfigId, structuredClone(provider))
    }
  }

  setCredential(
    providerConfigId: string,
    credentialRef: string,
    credentialMode: Exclude<ProviderDescriptor['credentialMode'], 'none'>,
    updatedAt: string
  ): ProviderDescriptor {
    const current = this.#providers.get(providerConfigId)
    if (!current) {
      throw new TypeError('Unknown provider configuration')
    }
    return this.upsert({
      ...current,
      credentialRef,
      credentialMode,
      status: 'locked',
      updatedAt
    })
  }

  revoke(providerConfigId: string, updatedAt: string): ProviderDescriptor {
    const current = this.#providers.get(providerConfigId)
    if (!current) {
      throw new TypeError('Unknown provider configuration')
    }
    return this.upsert({
      ...current,
      credentialRef: null,
      status: 'revoked',
      updatedAt
    })
  }

  rebindEndpoint(
    providerConfigId: string,
    endpointOrigin: string,
    updatedAt: string
  ): ProviderDescriptor {
    const current = this.#providers.get(providerConfigId)
    if (!current) {
      throw new TypeError('Unknown provider configuration')
    }
    const rebound = providerDescriptorSchema.parse({
      ...current,
      endpointOrigin: normalizeEndpointOrigin(
        endpointOrigin,
        current.execution
      ),
      credentialRef: null,
      status: 'locked',
      updatedAt
    })
    this.#providers.set(providerConfigId, structuredClone(rebound))
    return structuredClone(rebound)
  }

  recordConnectionTest(
    providerConfigId: string,
    input: ProviderConnectionResult
  ): ProviderDescriptor {
    const current = this.#providers.get(providerConfigId)
    if (!current) {
      throw new TypeError('Unknown provider configuration')
    }
    const result = providerConnectionResultSchema.parse(input)
    const { providerStatus, ...lastConnectionTest } = result
    return this.upsert({
      ...current,
      status: providerStatus,
      updatedAt: result.checkedAt,
      lastConnectionTest
    })
  }
}
