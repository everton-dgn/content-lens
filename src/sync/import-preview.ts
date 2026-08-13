import { syncEntityId } from '@/sync/canonical'
import type { SyncEntityType, SyncEnvelope } from '@/sync/contracts'

const categoryOrder: readonly SyncEntityType[] = [
  'portableProviders',
  'modelCatalog',
  'modelBindings',
  'rules',
  'exclusions',
  'identities',
  'platformPreferences'
]

export type PortableCategoryDiff = {
  added: number
  changed: number
  removed: number
  unchanged: number
}

function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function entities(envelope: SyncEnvelope, category: SyncEntityType) {
  return new Map(
    envelope.profile[category].map(value => [
      syncEntityId(category, value as unknown as Record<string, unknown>),
      value
    ])
  )
}

export function previewPortableChanges(
  current: SyncEnvelope,
  incoming: SyncEnvelope
) {
  const categories = Object.fromEntries(
    categoryOrder.map(category => {
      const before = entities(current, category)
      const after = entities(incoming, category)
      const ids = new Set([...before.keys(), ...after.keys()])
      const diff: PortableCategoryDiff = {
        added: 0,
        changed: 0,
        removed: 0,
        unchanged: 0
      }
      for (const id of ids) {
        if (!before.has(id)) {
          diff.added += 1
        } else if (!after.has(id)) {
          diff.removed += 1
        } else if (stable(before.get(id)) === stable(after.get(id))) {
          diff.unchanged += 1
        } else {
          diff.changed += 1
        }
      }
      return [category, diff]
    })
  ) as Record<SyncEntityType, PortableCategoryDiff>
  const totals = Object.values(categories).reduce(
    (result, category) => ({
      added: result.added + category.added,
      changed: result.changed + category.changed,
      removed: result.removed + category.removed,
      unchanged: result.unchanged + category.unchanged
    }),
    { added: 0, changed: 0, removed: 0, unchanged: 0 }
  )
  return {
    categories,
    totals,
    tombstones: incoming.tombstones.length
  }
}
