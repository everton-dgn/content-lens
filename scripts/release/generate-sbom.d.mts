export function flattenDependencies(
  dependencies?: Record<string, unknown>
): Array<{ name: string; version: string }>

export function createSbom(input: unknown): {
  spdxVersion: string
  packages: unknown[]
  relationships: unknown[]
}
