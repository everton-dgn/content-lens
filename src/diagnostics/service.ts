import { diagnosticCatalog } from '@/diagnostics/catalog'
import {
  DIAGNOSTIC_SCHEMA_VERSION,
  type DiagnosticCode,
  type DiagnosticEvent,
  type DiagnosticFilters,
  diagnosticEventSchema
} from '@/diagnostics/contracts'
import { DiagnosticStore } from '@/diagnostics/store'

type DiagnosticServiceOptions = {
  productVersion?: string
  randomId?: () => string
  versionDomains?: DiagnosticEvent['versionDomains']
}

type RecordDiagnosticOptions = {
  occurredAt: string
  scopeKey?: DiagnosticEvent['scopeKey']
}

const systemRandomId = () => crypto.randomUUID()

export class DiagnosticService {
  readonly #productVersion: string
  readonly #randomId: () => string
  readonly #store: DiagnosticStore
  readonly #versionDomains: DiagnosticEvent['versionDomains']

  constructor(
    store = new DiagnosticStore(),
    options: DiagnosticServiceOptions = {}
  ) {
    this.#store = store
    this.#productVersion = options.productVersion ?? '0.0.0'
    this.#randomId = options.randomId ?? systemRandomId
    this.#versionDomains = options.versionDomains ?? {
      database: '2',
      profile: '1.0',
      rules: '1'
    }
  }

  async record(code: DiagnosticCode, options: RecordDiagnosticOptions) {
    const event = diagnosticEventSchema.parse({
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      code,
      ...diagnosticCatalog[code],
      ...(options.scopeKey ? { scopeKey: options.scopeKey } : {}),
      occurredAt: options.occurredAt,
      correlationId: this.#randomId(),
      productVersion: this.#productVersion,
      versionDomains: this.#versionDomains
    })
    return this.#store.record(event)
  }

  list(filters: DiagnosticFilters = {}) {
    return this.#store.list(filters)
  }

  export(exportedAt: string, filters: DiagnosticFilters = {}) {
    return this.#store.export(exportedAt, filters)
  }

  clear() {
    return this.#store.clear()
  }
}
