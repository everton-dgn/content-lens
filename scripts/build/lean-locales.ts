export interface MessageEntry {
  message: string
  description?: string
  placeholders?: Record<string, { content: string }>
}

export type MessageCatalog = Record<string, MessageEntry>

/**
 * Drops the `description` of every message and prints without indentation.
 * The field documents each string for translators and the browser never reads
 * it, so it is repository content rather than package content.
 */
export const renderLeanCatalog = (catalog: unknown): string => {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new TypeError('A message catalog must be an object.')
  }
  const entries = Object.entries(catalog as MessageCatalog).map(
    ([key, entry]): [string, MessageEntry] => {
      if (typeof entry?.message !== 'string') {
        throw new TypeError(`Message "${key}" must contain text.`)
      }
      return [
        key,
        entry.placeholders
          ? { message: entry.message, placeholders: entry.placeholders }
          : { message: entry.message }
      ]
    }
  )

  return JSON.stringify(Object.fromEntries(entries))
}
