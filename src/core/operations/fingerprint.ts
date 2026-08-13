type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export function comparePortableStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalize(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => comparePortableStrings(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    )
  }
  throw new TypeError('Value is not portable JSON')
}

export async function fingerprintPortableValue(value: unknown) {
  const serialized = JSON.stringify(canonicalize(value))
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serialized)
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}
