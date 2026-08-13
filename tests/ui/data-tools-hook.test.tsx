import { IDBFactory } from 'fake-indexeddb'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLocalProfile } from '@/application/profile/local-profile'
import { DiagnosticService } from '@/diagnostics/service'
import { DiagnosticStore } from '@/diagnostics/store'
import { ContentLensDatabase } from '@/storage/indexed-db/database'
import { serializePortableProfile } from '@/ui/data/portability'
import { useDataTools } from '@/ui/data/useDataTools'

const at = '2026-07-31T12:00:00.000Z'
const mounted: Array<{ container: HTMLDivElement; root: Root }> = []

type DataTools = ReturnType<typeof useDataTools>
let tools: DataTools | undefined

const currentTools = () => {
  if (!tools) throw new Error('Data tools hook is not mounted')
  return tools
}

const invoke = async <T,>(operation: () => Promise<T>) => {
  let result: T | undefined
  await act(async () => {
    result = await operation()
  })
  return result as T
}

async function mount(input: {
  database: ContentLensDatabase
  diagnostics: DiagnosticService
  onProfileChanged: () => Promise<void>
}) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ container, root })
  const Harness = () => {
    tools = useDataTools(input)
    return null
  }
  await act(async () => root.render(<Harness />))
  await vi.waitFor(() => expect(currentTools().state.status).toBe('ready'))
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  tools = undefined
})

afterEach(async () => {
  while (mounted.length > 0) {
    const view = mounted.pop()
    if (view) {
      await act(async () => view.root.unmount())
      view.container.remove()
    }
  }
})

describe('data tools hook', () => {
  it('runs export, preview, replace, restore, diagnostics and reset flows', async () => {
    const factory = new IDBFactory()
    const database = new ContentLensDatabase({
      factory,
      databaseName: 'contentlens-data-tools-success'
    })
    const source = new ContentLensDatabase({
      factory,
      databaseName: 'contentlens-data-tools-source'
    })
    const diagnostics = new DiagnosticService(
      new DiagnosticStore({
        factory,
        databaseName: 'contentlens-data-tools-diagnostics'
      }),
      { randomId: () => '00000000-0000-4000-8000-000000000111' }
    )
    const targetProfile = createLocalProfile({
      at,
      profileId: 'profile:data-tools-target'
    })
    const sourceProfile = createLocalProfile({
      at,
      profileId: 'profile:data-tools-source'
    })
    await database.saveProfile(targetProfile)
    await source.saveProfile(sourceProfile)
    const onProfileChanged = vi.fn(async () => undefined)
    await mount({ database, diagnostics, onProfileChanged })

    await expect(
      invoke(() => currentTools().exportProfile())
    ).resolves.toMatchObject({ profileId: targetProfile.profileId })
    const legacyPreview = await invoke(() =>
      currentTools().previewImport(serializePortableProfile(sourceProfile))
    )
    expect(legacyPreview).toMatchObject({
      ok: true,
      summary: { profileIdChanges: true }
    })
    if (!legacyPreview.ok) throw new Error('Expected valid legacy preview')
    await expect(
      invoke(() => currentTools().applyImport(legacyPreview))
    ).resolves.toBe('committed')
    await expect(
      invoke(() => currentTools().restoreImportSnapshot())
    ).resolves.toBe('committed')

    const plaintext = await invoke(() =>
      currentTools().exportPortablePlaintext()
    )
    const encrypted = await invoke(() =>
      currentTools().exportPortableEncrypted('synthetic-passphrase')
    )
    expect(plaintext).toContain('"format": "content-lens-portability"')
    expect(encrypted).not.toContain(targetProfile.profileId)
    const sourcePortable = await new (
      await import('@/application/import-export/service')
    ).PortableImportExportService(source).exportPlaintext(at)
    const portableResult = await invoke(() =>
      currentTools().previewPortableImport(sourcePortable)
    )
    expect(portableResult.state).toBe('preview')
    if (portableResult.state !== 'preview')
      throw new Error('Expected portable preview')
    await expect(
      invoke(() =>
        currentTools().resolvePortableConflicts(portableResult.preview, [])
      )
    ).resolves.toEqual({ state: 'resolution-unavailable' })
    await expect(
      invoke(() => currentTools().applyPortableMerge(portableResult.preview))
    ).resolves.toBe('failed')
    await expect(
      invoke(() => currentTools().applyPortableReplace(portableResult.preview))
    ).resolves.toBe('committed')
    await expect(
      invoke(() => currentTools().restorePortableImportSnapshot())
    ).resolves.toBe('committed')

    await act(async () => {
      await diagnostics.record('unexpected-ui-error', {
        occurredAt: at,
        scopeKey: 'sidepanel'
      })
    })
    await expect(
      invoke(() => currentTools().exportDiagnostics())
    ).resolves.toMatchObject({ schemaVersion: 1 })
    await expect(invoke(() => currentTools().clearDiagnostics())).resolves.toBe(
      true
    )

    vi.spyOn(database, 'restoreMigrationSnapshot').mockResolvedValueOnce({
      state: 'restored',
      revision: 1
    })
    await expect(invoke(() => currentTools().restore())).resolves.toBe(
      'committed'
    )
    await expect(invoke(() => currentTools().reset())).resolves.toBe(
      'committed'
    )
    expect(onProfileChanged).toHaveBeenCalledTimes(6)
  })

  it('keeps durable operation intents across pending and uncertain responses', async () => {
    const factory = new IDBFactory()
    const database = new ContentLensDatabase({
      factory,
      databaseName: 'contentlens-data-tools-failure'
    })
    const diagnostics = new DiagnosticService(
      new DiagnosticStore({
        factory,
        databaseName: 'contentlens-data-tools-failure-diagnostics'
      }),
      { randomId: () => '00000000-0000-4000-8000-000000000222' }
    )
    const profile = createLocalProfile({
      at,
      profileId: 'profile:data-tools-failure'
    })
    await database.saveProfile(profile)
    await mount({
      database,
      diagnostics,
      onProfileChanged: vi.fn(async () => undefined)
    })
    const portableRaw = await invoke(() =>
      currentTools().exportPortablePlaintext()
    )
    const portablePreview = await invoke(() =>
      currentTools().previewPortableImport(portableRaw)
    )
    if (portablePreview.state !== 'preview') {
      throw new Error('Expected a portable preview for failure paths')
    }
    const { PortableImportExportService } = await import(
      '@/application/import-export/service'
    )
    vi.spyOn(PortableImportExportService.prototype, 'merge')
      .mockResolvedValueOnce({
        state: 'pending',
        operationId: 'portable-merge:pending'
      })
      .mockResolvedValueOnce({ state: 'merge-unavailable' })
      .mockRejectedValueOnce(new Error('interrupted'))
    await expect(
      invoke(() => currentTools().applyPortableMerge(portablePreview.preview))
    ).resolves.toBe('pending')
    await expect(
      invoke(() => currentTools().applyPortableMerge(portablePreview.preview))
    ).resolves.toBe('failed')
    await expect(
      invoke(() => currentTools().applyPortableMerge(portablePreview.preview))
    ).resolves.toBe('pending')
    const preview = {
      ok: true as const,
      raw: serializePortableProfile(profile),
      summary: {
        currentRevision: 0,
        feedbackExamples: 0,
        incomingRevision: 0,
        profileIdChanges: false,
        rules: 0
      }
    }

    const importProfile = vi.spyOn(database, 'importProfile')
    importProfile.mockResolvedValueOnce({
      state: 'pending',
      operationId: 'operation:pending'
    })
    await expect(
      invoke(() => currentTools().applyImport(preview))
    ).resolves.toBe('pending')
    importProfile.mockResolvedValueOnce({
      state: 'invalid',
      code: 'profile-invalid',
      issues: []
    })
    await expect(
      invoke(() => currentTools().applyImport(preview))
    ).resolves.toBe('failed')
    importProfile.mockRejectedValueOnce(new Error('interrupted'))
    await expect(
      invoke(() => currentTools().applyImport(preview))
    ).resolves.toBe('pending')

    vi.spyOn(database, 'restoreMigrationSnapshot')
      .mockResolvedValueOnce({
        state: 'pending',
        operationId: 'restore:pending'
      })
      .mockResolvedValueOnce({ state: 'snapshot-unavailable' })
      .mockRejectedValueOnce(new Error('interrupted'))
    await expect(invoke(() => currentTools().restore())).resolves.toBe(
      'pending'
    )
    await expect(invoke(() => currentTools().restore())).resolves.toBe('failed')
    await expect(invoke(() => currentTools().restore())).resolves.toBe(
      'pending'
    )

    vi.spyOn(database, 'restoreImportSnapshot')
      .mockResolvedValueOnce({
        state: 'pending',
        operationId: 'import-restore:pending'
      })
      .mockResolvedValueOnce({ state: 'snapshot-unavailable' })
      .mockRejectedValueOnce(new Error('interrupted'))
    await expect(
      invoke(() => currentTools().restoreImportSnapshot())
    ).resolves.toBe('pending')
    await expect(
      invoke(() => currentTools().restoreImportSnapshot())
    ).resolves.toBe('failed')
    await expect(
      invoke(() => currentTools().restoreImportSnapshot())
    ).resolves.toBe('pending')

    vi.spyOn(database, 'restorePortableImportSnapshot')
      .mockResolvedValueOnce({
        state: 'pending',
        operationId: 'portable-restore:pending'
      })
      .mockResolvedValueOnce({ state: 'snapshot-unavailable' })
      .mockRejectedValueOnce(new Error('interrupted'))
    await expect(
      invoke(() => currentTools().restorePortableImportSnapshot())
    ).resolves.toBe('pending')
    await expect(
      invoke(() => currentTools().restorePortableImportSnapshot())
    ).resolves.toBe('failed')
    await expect(
      invoke(() => currentTools().restorePortableImportSnapshot())
    ).resolves.toBe('pending')

    vi.spyOn(diagnostics, 'clear').mockRejectedValueOnce(
      new Error('unavailable')
    )
    await expect(invoke(() => currentTools().clearDiagnostics())).resolves.toBe(
      false
    )
    const { RecoveryService } = await import('@/application/recovery/service')
    const reset = vi.spyOn(RecoveryService.prototype, 'reset')
    reset.mockResolvedValueOnce({ state: 'confirmation-required' })
    await expect(invoke(() => currentTools().reset())).resolves.toBe('failed')

    const inspect = vi.spyOn(RecoveryService.prototype, 'inspect')
    const blocked = {
      state: 'blocked-unreadable' as const,
      primaryAction: 'import-profile' as const,
      actions: ['import-profile', 'reset'] as const,
      preserved: [] as const
    }
    reset.mockRejectedValueOnce(new Error('response lost'))
    inspect.mockResolvedValueOnce(blocked).mockResolvedValueOnce(blocked)
    await expect(invoke(() => currentTools().reset())).resolves.toBe(
      'committed'
    )

    const readable = {
      state: 'readable' as const,
      primaryAction: 'export-profile' as const,
      actions: ['export-profile', 'reset'] as const,
      preserved: ['profile', 'rules', 'feedback'] as const
    }
    reset.mockRejectedValueOnce(new Error('response lost'))
    inspect.mockResolvedValueOnce(readable).mockResolvedValueOnce(readable)
    await expect(invoke(() => currentTools().reset())).resolves.toBe('failed')
    await expect(diagnostics.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'operation-response-uncertain' })
      ])
    )
  })
})
