import { nonEmptyStringSchema } from '@/core/content/contracts'
import {
  type CredentialBinding,
  credentialBindingSchema,
  unwrapCredential,
  wrapCredential
} from '@/security/credentials/crypto-envelope'
import {
  type CredentialDurableRecord,
  credentialDurableRecordSchema
} from '@/security/credentials/durable-record'

type ProxyCredentialMode = 'none' | 'session-only' | 'passphrase-wrapped'

export type ExternalVaultConfiguration = {
  externalReference: string
  proxyCredential?:
    | {
        mode: 'session-only'
        value: string
      }
    | {
        mode: 'passphrase-wrapped'
        value: string
        passphrase: string
      }
}

function bindingEquals(left: CredentialBinding, right: CredentialBinding) {
  return (
    left.providerConfigId === right.providerConfigId &&
    left.endpointOrigin === right.endpointOrigin
  )
}

export class CredentialVault {
  readonly #records = new Map<string, CredentialDurableRecord>()
  readonly #sessionValues = new Map<string, string>()
  readonly #unlockedValues = new Map<string, string>()

  constructor(records: readonly unknown[] = []) {
    for (const input of records) {
      const record = credentialDurableRecordSchema.parse(input)
      if (this.#records.has(record.reference)) {
        throw new TypeError('Duplicate credential reference')
      }
      this.#records.set(record.reference, structuredClone(record))
    }
  }

  fork() {
    const fork = new CredentialVault(this.durableSnapshot())
    for (const [reference, value] of this.#sessionValues) {
      fork.#sessionValues.set(reference, value)
    }
    for (const [reference, value] of this.#unlockedValues) {
      fork.#unlockedValues.set(reference, value)
    }
    return fork
  }

  replaceWith(source: CredentialVault) {
    this.#records.clear()
    this.#sessionValues.clear()
    this.#unlockedValues.clear()
    for (const [reference, record] of source.#records) {
      this.#records.set(reference, structuredClone(record))
    }
    for (const [reference, value] of source.#sessionValues) {
      this.#sessionValues.set(reference, value)
    }
    for (const [reference, value] of source.#unlockedValues) {
      this.#unlockedValues.set(reference, value)
    }
  }

  async storeSession(bindingInput: CredentialBinding, value: string) {
    const binding = credentialBindingSchema.parse(bindingInput)
    const reference = this.#newReference()
    const record = credentialDurableRecordSchema.parse({
      schemaVersion: 1,
      reference,
      mode: 'session-only',
      binding: structuredClone(binding)
    })
    this.#records.set(reference, record)
    this.#sessionValues.set(reference, value)
    return reference
  }

  async storeWrapped(
    bindingInput: CredentialBinding,
    value: string,
    passphrase: string
  ) {
    const binding = credentialBindingSchema.parse(bindingInput)
    const reference = this.#newReference()
    const envelope = await wrapCredential({
      value,
      passphrase,
      binding
    })
    const record = credentialDurableRecordSchema.parse({
      schemaVersion: 1,
      reference,
      mode: 'passphrase-wrapped',
      binding: structuredClone(binding),
      envelope
    })
    this.#records.set(reference, record)
    return reference
  }

  async storeExternal(
    bindingInput: CredentialBinding,
    input: ExternalVaultConfiguration
  ) {
    const binding = credentialBindingSchema.parse(bindingInput)
    const externalReference = nonEmptyStringSchema
      .max(256)
      .parse(input.externalReference)
    const reference = this.#newReference()
    const proxyCredentialMode = input.proxyCredential?.mode ?? 'none'
    const envelope =
      input.proxyCredential?.mode === 'passphrase-wrapped'
        ? await wrapCredential({
            value: input.proxyCredential.value,
            passphrase: input.proxyCredential.passphrase,
            binding
          })
        : undefined
    const record = credentialDurableRecordSchema.parse({
      schemaVersion: 1,
      reference,
      mode: 'external-vault',
      binding: structuredClone(binding),
      externalReference,
      proxyCredentialMode,
      ...(envelope ? { envelope } : {})
    })
    this.#records.set(reference, record)
    if (input.proxyCredential?.mode === 'session-only') {
      this.#sessionValues.set(reference, input.proxyCredential.value)
    }
    return reference
  }

  async unlock(
    reference: string,
    bindingInput: CredentialBinding,
    passphrase: string
  ) {
    const binding = credentialBindingSchema.parse(bindingInput)
    const record = this.#records.get(reference)
    const envelope =
      record?.mode === 'passphrase-wrapped'
        ? record.envelope
        : record?.mode === 'external-vault' &&
            record.proxyCredentialMode === 'passphrase-wrapped'
          ? record.envelope
          : undefined
    if (
      !record ||
      this.#valueMode(record) !== 'passphrase-wrapped' ||
      !envelope ||
      !bindingEquals(record.binding, binding)
    ) {
      throw new Error('credential-unavailable')
    }
    const value = await unwrapCredential({
      envelope,
      passphrase,
      binding
    })
    this.#unlockedValues.set(reference, value)
  }

  async use<Result>(
    reference: string,
    bindingInput: CredentialBinding,
    consumer: (value: string) => Result | Promise<Result>
  ): Promise<Result> {
    const binding = credentialBindingSchema.parse(bindingInput)
    const record = this.#records.get(reference)
    if (!record || !bindingEquals(record.binding, binding)) {
      throw new Error('credential-unavailable')
    }
    const valueMode = this.#valueMode(record)
    const value =
      valueMode === 'session-only'
        ? this.#sessionValues.get(reference)
        : this.#unlockedValues.get(reference)
    if (value === undefined) {
      throw new Error(
        valueMode === 'passphrase-wrapped'
          ? 'credential-locked'
          : 'credential-unavailable'
      )
    }
    return consumer(value)
  }

  async remove(reference: string) {
    this.#sessionValues.delete(reference)
    this.#unlockedValues.delete(reference)
    return this.#records.delete(reference)
  }

  async clear() {
    this.#records.clear()
    this.#sessionValues.clear()
    this.#unlockedValues.clear()
  }

  durableSnapshot() {
    return [...this.#records.values()]
      .sort((left, right) => left.reference.localeCompare(right.reference))
      .map(record => structuredClone(record))
  }

  metadata() {
    return [...this.#records.values()].map(record => ({
      reference: record.reference,
      mode: record.mode,
      binding: structuredClone(record.binding),
      ...(record.mode === 'external-vault'
        ? {
            externalReference: record.externalReference,
            proxyCredentialMode: record.proxyCredentialMode
          }
        : {}),
      locked: this.#isLocked(record)
    }))
  }

  #isLocked(record: CredentialDurableRecord) {
    const valueMode = this.#valueMode(record)
    if (valueMode === 'session-only') {
      return !this.#sessionValues.has(record.reference)
    }
    if (valueMode === 'passphrase-wrapped') {
      return !this.#unlockedValues.has(record.reference)
    }
    return false
  }

  #valueMode(record: CredentialDurableRecord): ProxyCredentialMode {
    return record.mode === 'external-vault'
      ? record.proxyCredentialMode
      : record.mode
  }

  #newReference() {
    return `credential:${crypto.randomUUID()}`
  }
}
