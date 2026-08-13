import {
  type ConsentKey,
  type ConsentReceipt,
  consentKeyEquals,
  consentReceiptSchema,
  normalizeConsentKey
} from '@/ai/providers/contracts'

function keyFor(key: ConsentKey) {
  return JSON.stringify(key)
}

export class ConsentRepository {
  readonly #receipts = new Map<string, ConsentReceipt>()

  constructor(receipts: readonly ConsentReceipt[] = []) {
    for (const receipt of receipts) {
      this.grant(receipt)
    }
  }

  fork() {
    return new ConsentRepository(this.snapshot())
  }

  replaceWith(source: ConsentRepository) {
    this.#receipts.clear()
    for (const receipt of source.snapshot()) {
      this.grant(receipt)
    }
  }

  grant(input: ConsentReceipt): ConsentReceipt {
    const parsed = consentReceiptSchema.parse(input)
    const normalizedKey = normalizeConsentKey(parsed.key)
    const receipt = consentReceiptSchema.parse({
      ...parsed,
      key: normalizedKey
    })
    this.#receipts.set(keyFor(normalizedKey), structuredClone(receipt))
    return structuredClone(receipt)
  }

  has(key: ConsentKey) {
    const normalized = normalizeConsentKey(key)
    const receipt = this.#receipts.get(keyFor(normalized))
    return receipt ? consentKeyEquals(receipt.key, normalized) : false
  }

  hasForProvider(providerConfigId: string) {
    return [...this.#receipts.values()].some(
      receipt => receipt.key.providerConfigId === providerConfigId
    )
  }

  revokeProvider(providerConfigId: string) {
    let removed = 0
    for (const [key, receipt] of this.#receipts) {
      if (receipt.key.providerConfigId === providerConfigId) {
        this.#receipts.delete(key)
        removed += 1
      }
    }
    return removed
  }

  snapshot() {
    return [...this.#receipts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, receipt]) => structuredClone(receipt))
  }
}
