export type AssistanceCache = {
  read(key: string): Promise<unknown | undefined>
  write(key: string, value: unknown): Promise<void>
}

export class MemoryAssistanceCache implements AssistanceCache {
  readonly #entries = new Map<string, unknown>()

  async read(key: string) {
    const value = this.#entries.get(key)
    return value === undefined ? undefined : structuredClone(value)
  }

  async write(key: string, value: unknown) {
    this.#entries.set(key, structuredClone(value))
  }
}
