import {
  type ModelDescriptor,
  type ModelRef,
  type ModelTask,
  modelDescriptorSchema
} from '@/ai/models/contracts'

function modelKey(reference: ModelRef) {
  return `${reference.providerConfigId}\u0000${reference.modelId}`
}

export class ModelCatalog {
  readonly #models = new Map<string, ModelDescriptor>()

  constructor(models: readonly unknown[] = []) {
    for (const model of models) {
      const parsed = modelDescriptorSchema.parse(model)
      const key = modelKey(parsed)
      if (this.#models.has(key)) {
        throw new TypeError('Duplicate model reference')
      }
      this.#models.set(key, structuredClone(parsed))
    }
  }

  get(reference: ModelRef): ModelDescriptor | undefined {
    const model = this.#models.get(modelKey(reference))
    return model ? structuredClone(model) : undefined
  }

  list(): ModelDescriptor[] {
    return [...this.#models.values()]
      .sort((left, right) =>
        modelKey(left).localeCompare(modelKey(right), 'en')
      )
      .map(model => structuredClone(model))
  }

  fork() {
    return new ModelCatalog(this.list())
  }

  replaceWith(source: ModelCatalog) {
    const models = source.list()
    this.#models.clear()
    for (const model of models) {
      this.#models.set(modelKey(model), structuredClone(model))
    }
  }

  removeProviderModels(providerConfigId: string): ModelDescriptor[] {
    const removed: ModelDescriptor[] = []
    for (const [key, model] of this.#models) {
      if (model.providerConfigId === providerConfigId) {
        removed.push(structuredClone(model))
        this.#models.delete(key)
      }
    }
    return removed.sort((left, right) =>
      modelKey(left).localeCompare(modelKey(right), 'en')
    )
  }

  upsertBuiltIn(input: unknown): ModelDescriptor {
    const parsed = modelDescriptorSchema.parse(input)
    if (parsed.catalogSource !== 'built-in') {
      throw new TypeError('built-in-model-source-required')
    }
    this.#models.set(modelKey(parsed), structuredClone(parsed))
    return structuredClone(parsed)
  }

  upsertUser(input: unknown): ModelDescriptor {
    const parsed = modelDescriptorSchema.parse(input)
    if (parsed.catalogSource !== 'user') {
      throw new TypeError('user-model-source-required')
    }
    this.#models.set(modelKey(parsed), structuredClone(parsed))
    return structuredClone(parsed)
  }

  capability(reference: ModelRef, task: ModelTask) {
    const model = this.#models.get(modelKey(reference))
    const capability = model?.capabilities.find(
      candidate => candidate.task === task
    )
    return capability ? structuredClone(capability) : undefined
  }

  supports(reference: ModelRef, task: ModelTask): boolean {
    const model = this.#models.get(modelKey(reference))
    return (
      model?.status === 'available' &&
      model.capabilities.some(capability => capability.task === task)
    )
  }

  supportsModality(reference: ModelRef, modality: 'text' | 'image'): boolean {
    const model = this.#models.get(modelKey(reference))
    return (
      model?.status === 'available' &&
      model.capabilities.some(capability =>
        capability.modalities.includes(modality)
      )
    )
  }

  synchronizeProviderModels(
    providerConfigId: string,
    models: readonly unknown[],
    checkedAt: string
  ): ModelDescriptor[] {
    const discoveredKeys = new Set<string>()
    const discovered: ModelDescriptor[] = []
    for (const input of models) {
      const parsed = modelDescriptorSchema.parse(input)
      if (parsed.providerConfigId !== providerConfigId) {
        throw new TypeError('model-provider-mismatch')
      }
      const normalized = modelDescriptorSchema.parse({
        ...parsed,
        catalogSource: 'provider',
        lastCheckedAt: checkedAt,
        status: 'available',
        capabilities: parsed.capabilities.map(capability => ({
          ...capability,
          evidence: 'declared',
          source: 'provider',
          verifiedAt: null
        }))
      })
      const key = modelKey(normalized)
      const current = this.#models.get(key)
      if (current && current.catalogSource !== 'provider') {
        throw new TypeError('model-source-conflict')
      }
      discoveredKeys.add(key)
      this.#models.set(key, structuredClone(normalized))
      discovered.push(structuredClone(normalized))
    }

    for (const [key, current] of this.#models) {
      if (
        current.providerConfigId === providerConfigId &&
        current.catalogSource === 'provider' &&
        !discoveredKeys.has(key)
      ) {
        this.#models.set(
          key,
          modelDescriptorSchema.parse({
            ...current,
            status: 'unavailable',
            lastCheckedAt: checkedAt
          })
        )
      }
    }
    return discovered
  }

  updateManualModel(
    currentReference: ModelRef,
    input: unknown,
    options: { referencedByActiveRoute: boolean }
  ): ModelDescriptor {
    const current = this.#models.get(modelKey(currentReference))
    if (current?.catalogSource !== 'user') {
      throw new TypeError('manual-model-not-found')
    }
    const parsed = modelDescriptorSchema.parse(input)
    const normalized = modelDescriptorSchema.parse({
      ...parsed,
      catalogSource: 'user',
      capabilities: parsed.capabilities.map(capability => ({
        ...capability,
        source: 'user'
      }))
    })
    const currentKey = modelKey(currentReference)
    const nextKey = modelKey(normalized)
    if (currentKey !== nextKey && options.referencedByActiveRoute) {
      throw new TypeError('model-route-migration-required')
    }
    const conflicting = this.#models.get(nextKey)
    if (currentKey !== nextKey && conflicting) {
      throw new TypeError('duplicate-model-reference')
    }
    if (currentKey !== nextKey) {
      this.#models.delete(currentKey)
    }
    this.#models.set(nextKey, structuredClone(normalized))
    return structuredClone(normalized)
  }

  summarizeTaskEligibility(task: ModelTask) {
    const summary = {
      task,
      available: 0,
      unavailable: 0,
      invalid: 0,
      byExecutionKind: {
        local: 0,
        browser: 0,
        cloud: 0
      }
    }
    for (const model of this.#models.values()) {
      if (!model.capabilities.some(capability => capability.task === task)) {
        continue
      }
      summary[model.status] += 1
      if (model.status === 'available') {
        summary.byExecutionKind[model.executionKind] += 1
      }
    }
    return structuredClone(summary)
  }
}
