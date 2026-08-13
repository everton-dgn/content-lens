export function createProvenance(input: unknown): {
  _type: string
  predicateType: string
  subject: Array<{ name: string; digest: { sha256: string } }>
}
