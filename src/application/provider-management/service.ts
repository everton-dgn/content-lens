import type { ModelCatalog } from '@/ai/models/catalog'
import type { ModelDescriptor } from '@/ai/models/contracts'
import type { ConsentRepository } from '@/ai/providers/consent'
import type {
  ConsentReceipt,
  ProviderDescriptor
} from '@/ai/providers/contracts'
import { normalizeEndpointOrigin } from '@/ai/providers/contracts'
import type { ProviderRegistry } from '@/ai/providers/registry'
import { refreshProviderCatalog } from '@/application/provider-management/catalog-refresh'
import {
  type ProviderConnectionTestInput,
  type ProviderPermissionProbe,
  runProviderConnectionTest
} from '@/application/provider-management/connection-test'
import type { ProviderStateWriter } from '@/application/provider-management/persistence'
import type {
  CredentialVault,
  ExternalVaultConfiguration
} from '@/security/credentials/vault'

type PermissionPort = {
  remove(origin: string): boolean | Promise<boolean>
  has?: ProviderPermissionProbe['has']
}

type ProviderManagementOptions = {
  registry: ProviderRegistry
  vault: CredentialVault
  consents: ConsentRepository
  permissions: PermissionPort
  catalog?: ModelCatalog
  persistence?: ProviderStateWriter
}

type ProviderManagementState = {
  providers: ProviderRegistry
  catalog?: ModelCatalog
  consents: ConsentRepository
  vault: CredentialVault
}

type ConnectionTestOptions = Omit<
  ProviderConnectionTestInput,
  'provider' | 'vault' | 'permissions'
>

type CatalogRefreshOptions = {
  checkedAt: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  userInitiated: boolean
}

export class ProviderManagementService {
  readonly #registry: ProviderRegistry
  readonly #vault: CredentialVault
  readonly #consents: ConsentRepository
  readonly #permissions: PermissionPort
  readonly #catalog?: ModelCatalog
  readonly #persistence?: ProviderStateWriter

  constructor(options: ProviderManagementOptions) {
    this.#registry = options.registry
    this.#vault = options.vault
    this.#consents = options.consents
    this.#permissions = options.permissions
    this.#catalog = options.catalog
    this.#persistence = options.persistence
    if ((this.#catalog === undefined) !== (this.#persistence === undefined)) {
      throw new TypeError(
        'Provider persistence requires the shared model catalog'
      )
    }
  }

  async registerProvider(
    input: ProviderDescriptor
  ): Promise<ProviderDescriptor> {
    return this.#mutate(async state => {
      if (state.providers.get(input.providerConfigId)) {
        throw new TypeError('provider-configuration-already-exists')
      }
      return state.providers.upsert(input)
    })
  }

  async registerModel(input: ModelDescriptor): Promise<ModelDescriptor> {
    return this.#mutate(async state => {
      const provider = this.#requireProvider(state, input.providerConfigId)
      if (!state.catalog) {
        throw new TypeError('Provider model catalog is unavailable')
      }
      if (input.executionKind !== provider.execution) {
        throw new TypeError('model-provider-execution-mismatch')
      }
      return state.catalog.upsertUser(input)
    })
  }

  async updateProvider(
    providerConfigId: string,
    input: { displayName: string; endpointOrigin: string },
    at: string
  ): Promise<ProviderDescriptor> {
    const result = await this.#mutate(async state => {
      const provider = this.#requireProvider(state, providerConfigId)
      if (provider.kind === 'browser-built-in') {
        throw new TypeError('built-in-provider-is-immutable')
      }
      const endpointOrigin = normalizeEndpointOrigin(
        input.endpointOrigin,
        provider.execution
      )
      const endpointChanged = endpointOrigin !== provider.endpointOrigin
      if (endpointChanged && provider.credentialRef) {
        await state.vault.remove(provider.credentialRef)
      }
      if (endpointChanged) {
        state.consents.revokeProvider(providerConfigId)
      }
      const { lastConnectionTest: _lastConnectionTest, ...stable } = provider
      const updated = state.providers.upsert({
        ...stable,
        displayName: input.displayName,
        endpointOrigin,
        credentialRef: endpointChanged ? null : provider.credentialRef,
        status: endpointChanged ? 'unconfigured' : provider.status,
        updatedAt: at,
        ...(!endpointChanged && provider.lastConnectionTest
          ? { lastConnectionTest: provider.lastConnectionTest }
          : {})
      })
      const previousOriginStillUsed = state.providers
        .list()
        .some(
          candidate =>
            candidate.providerConfigId !== providerConfigId &&
            candidate.endpointOrigin === provider.endpointOrigin &&
            candidate.status !== 'revoked'
        )
      return {
        endpointChanged,
        previousOrigin: provider.endpointOrigin,
        previousOriginStillUsed,
        updated
      }
    })
    if (result.endpointChanged && !result.previousOriginStillUsed) {
      await this.#permissions.remove(result.previousOrigin)
    }
    return result.updated
  }

  async removeProvider(providerConfigId: string) {
    const result = await this.#mutate(async state => {
      const provider = this.#requireProvider(state, providerConfigId)
      if (provider.kind === 'browser-built-in') {
        throw new TypeError('built-in-provider-is-immutable')
      }
      if (provider.credentialRef) {
        await state.vault.remove(provider.credentialRef)
      }
      state.consents.revokeProvider(providerConfigId)
      const removedModels =
        state.catalog?.removeProviderModels(providerConfigId) ?? []
      state.providers.remove(providerConfigId)
      const originStillUsed = state.providers
        .list()
        .some(
          candidate =>
            candidate.endpointOrigin === provider.endpointOrigin &&
            candidate.status !== 'revoked'
        )
      return { originStillUsed, provider, removedModels }
    })
    if (!result.originStillUsed) {
      await this.#permissions.remove(result.provider.endpointOrigin)
    }
    return {
      provider: result.provider,
      removedModels: result.removedModels
    }
  }

  async grantConsent(input: ConsentReceipt): Promise<ConsentReceipt> {
    return this.#mutate(async state => {
      const provider = this.#requireProvider(state, input.key.providerConfigId)
      if (
        input.key.endpointOrigin !== provider.endpointOrigin ||
        input.providerKind !== provider.kind
      ) {
        throw new TypeError('consent-provider-binding-mismatch')
      }
      return state.consents.grant(input)
    })
  }

  async setSessionCredential(
    providerConfigId: string,
    value: string,
    at: string
  ): Promise<ProviderDescriptor> {
    return this.#mutate(async state => {
      const provider = this.#requireProvider(state, providerConfigId)
      const reference = await state.vault.storeSession(
        {
          providerConfigId,
          endpointOrigin: provider.endpointOrigin
        },
        value
      )
      return this.#replaceCredential(
        state,
        provider,
        reference,
        'session-only',
        at
      )
    })
  }

  async setWrappedCredential(
    providerConfigId: string,
    value: string,
    passphrase: string,
    at: string
  ): Promise<ProviderDescriptor> {
    return this.#mutate(async state => {
      const provider = this.#requireProvider(state, providerConfigId)
      const reference = await state.vault.storeWrapped(
        {
          providerConfigId,
          endpointOrigin: provider.endpointOrigin
        },
        value,
        passphrase
      )
      return this.#replaceCredential(
        state,
        provider,
        reference,
        'passphrase-wrapped',
        at
      )
    })
  }

  async setExternalVault(
    providerConfigId: string,
    configuration: ExternalVaultConfiguration,
    at: string
  ): Promise<ProviderDescriptor> {
    return this.#mutate(async state => {
      const provider = this.#requireProvider(state, providerConfigId)
      const reference = await state.vault.storeExternal(
        {
          providerConfigId,
          endpointOrigin: provider.endpointOrigin
        },
        configuration
      )
      return this.#replaceCredential(
        state,
        provider,
        reference,
        'external-vault',
        at
      )
    })
  }

  async disconnect(providerConfigId: string, at: string) {
    const result = await this.#mutate(async state => {
      const provider = this.#requireProvider(state, providerConfigId)
      if (provider.credentialRef) {
        await state.vault.remove(provider.credentialRef)
      }
      state.consents.revokeProvider(providerConfigId)
      const revoked = state.providers.revoke(providerConfigId, at)
      const originStillUsed = state.providers
        .list()
        .some(
          candidate =>
            candidate.providerConfigId !== providerConfigId &&
            candidate.endpointOrigin === provider.endpointOrigin &&
            candidate.status !== 'revoked'
        )
      return {
        revoked,
        origin: provider.endpointOrigin,
        originStillUsed
      }
    })
    if (!result.originStillUsed) {
      await this.#permissions.remove(result.origin)
    }
    return result.revoked
  }

  async testConnection(
    providerConfigId: string,
    options: ConnectionTestOptions
  ) {
    const permissionProbe = this.#permissions.has
    if (!permissionProbe) {
      throw new Error('provider-connection-permission-port-unavailable')
    }
    return this.#mutate(async state => {
      const provider = this.#requireProvider(state, providerConfigId)
      const result = await runProviderConnectionTest({
        ...options,
        provider,
        vault: state.vault,
        permissions: {
          has: (binding, dataCollection) =>
            permissionProbe.call(this.#permissions, binding, dataCollection)
        }
      })
      return {
        provider: state.providers.recordConnectionTest(
          providerConfigId,
          result
        ),
        result
      }
    })
  }

  async refreshCatalog(
    providerConfigId: string,
    options: CatalogRefreshOptions
  ): Promise<ModelDescriptor[]> {
    const permissionProbe = this.#permissions.has
    if (!permissionProbe) {
      throw new Error('provider-catalog-permission-port-unavailable')
    }
    return this.#mutate(async state => {
      const provider = this.#requireProvider(state, providerConfigId)
      if (!state.catalog) {
        throw new TypeError('Provider model catalog is unavailable')
      }
      const models = await refreshProviderCatalog({
        ...options,
        provider,
        vault: state.vault,
        permissions: {
          has: (binding, dataCollection) =>
            permissionProbe.call(this.#permissions, binding, dataCollection)
        }
      })
      return state.catalog.synchronizeProviderModels(
        providerConfigId,
        models,
        options.checkedAt
      )
    })
  }

  snapshot() {
    return {
      providers: this.#registry.list(),
      models: this.#catalog?.list() ?? [],
      credentials: this.#vault.metadata(),
      consents: this.#consents.snapshot()
    }
  }

  async #replaceCredential(
    state: ProviderManagementState,
    provider: ProviderDescriptor,
    reference: string,
    mode: Exclude<ProviderDescriptor['credentialMode'], 'none'>,
    at: string
  ) {
    try {
      const updated = state.providers.setCredential(
        provider.providerConfigId,
        reference,
        mode,
        at
      )
      if (provider.credentialRef) {
        await state.vault.remove(provider.credentialRef)
      }
      state.consents.revokeProvider(provider.providerConfigId)
      return updated
    } catch (error) {
      await state.vault.remove(reference)
      throw error
    }
  }

  async #mutate<Result>(
    mutation: (state: ProviderManagementState) => Promise<Result>
  ): Promise<Result> {
    const live = this.#runtime()
    if (!this.#persistence) {
      return mutation(live)
    }
    if (!live.catalog) {
      throw new TypeError('Provider model catalog is unavailable')
    }
    const draft = {
      providers: live.providers.fork(),
      catalog: live.catalog.fork(),
      consents: live.consents.fork(),
      vault: live.vault.fork()
    }
    const result = await mutation(draft)
    await this.#persistence.save(draft)
    live.providers.replaceWith(draft.providers)
    live.catalog.replaceWith(draft.catalog)
    live.consents.replaceWith(draft.consents)
    live.vault.replaceWith(draft.vault)
    return result
  }

  #runtime(): ProviderManagementState {
    return {
      providers: this.#registry,
      ...(this.#catalog ? { catalog: this.#catalog } : {}),
      consents: this.#consents,
      vault: this.#vault
    }
  }

  #requireProvider(state: ProviderManagementState, providerConfigId: string) {
    const provider = state.providers.get(providerConfigId)
    if (!provider) {
      throw new TypeError('Unknown provider configuration')
    }
    return provider
  }
}
