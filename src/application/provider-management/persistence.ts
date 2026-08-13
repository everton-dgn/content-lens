import { ModelCatalog } from '@/ai/models/catalog'
import { ConsentRepository } from '@/ai/providers/consent'
import { ProviderRegistry } from '@/ai/providers/registry'
import { CredentialVault } from '@/security/credentials/vault'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'
import { PROVIDER_STATE_SCHEMA_VERSION } from '@/storage/provider-state/contracts'

export type ProviderRuntimeState = {
  providers: ProviderRegistry
  catalog: ModelCatalog
  consents: ConsentRepository
  vault: CredentialVault
}

export type ProviderStateWriter = {
  save(state: ProviderRuntimeState): Promise<void>
}

export class ProviderStatePersistence {
  readonly #database: ContentLensDatabase

  constructor(database: ContentLensDatabase) {
    this.#database = database
  }

  async save(state: ProviderRuntimeState) {
    await this.#database.replaceProviderState({
      schemaVersion: PROVIDER_STATE_SCHEMA_VERSION,
      providers: state.providers.list(),
      models: state.catalog.list(),
      consents: state.consents.snapshot(),
      credentials: state.vault.durableSnapshot()
    })
  }

  async load(): Promise<ProviderRuntimeState> {
    const state = await this.#database.readProviderState()
    return {
      providers: new ProviderRegistry(state.providers),
      catalog: new ModelCatalog(state.models),
      consents: new ConsentRepository(state.consents),
      vault: new CredentialVault(state.credentials)
    }
  }
}
