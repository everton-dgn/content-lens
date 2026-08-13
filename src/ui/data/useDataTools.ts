import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  PortableImportExportService,
  type PortableImportPreview
} from '@/application/import-export/service'
import { RecoveryService } from '@/application/recovery/service'
import type { DiagnosticAggregate } from '@/diagnostics/contracts'
import type { DiagnosticService } from '@/diagnostics/service'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'
import type { SyncConflictResolution } from '@/sync/conflict-resolution'

type RecoveryState = Awaited<ReturnType<RecoveryService['inspect']>>

export type ImportPreview =
  | {
      ok: true
      raw: string
      summary: {
        currentRevision: number | null
        feedbackExamples: number
        incomingRevision: number
        profileIdChanges: boolean
        rules: number
      }
    }
  | { ok: false }

export type DataMutationOutcome = 'committed' | 'pending' | 'failed'

type MutationIntent = {
  at: string
  operationId: string
}

const createIntent = (): MutationIntent => ({
  at: new Date().toISOString(),
  operationId: `operation:data:${crypto.randomUUID()}`
})

type DataToolsState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready'
      diagnostics: DiagnosticAggregate[]
      importSnapshotAvailable: boolean
      portableImportSnapshotAvailable: boolean
      recovery: RecoveryState
    }

type UseDataToolsOptions = {
  database: ContentLensDatabase
  diagnostics: DiagnosticService
  onProfileChanged: () => Promise<void>
}

export const useDataTools = ({
  database,
  diagnostics,
  onProfileChanged
}: UseDataToolsOptions) => {
  const recovery = useMemo(() => new RecoveryService(database), [database])
  const portability = useMemo(
    () => new PortableImportExportService(database),
    [database]
  )
  const [state, setState] = useState<DataToolsState>({ status: 'loading' })
  const [pending, setPending] = useState(false)
  const importIntents = useRef(
    new WeakMap<Extract<ImportPreview, { ok: true }>, MutationIntent>()
  )
  const migrationRestoreIntent = useRef<MutationIntent | undefined>(undefined)
  const importRestoreIntent = useRef<MutationIntent | undefined>(undefined)
  const portableImportIntents = useRef(
    new WeakMap<PortableImportPreview, MutationIntent>()
  )
  const portableMergeIntents = useRef(
    new WeakMap<PortableImportPreview, MutationIntent>()
  )
  const portableRestoreIntent = useRef<MutationIntent | undefined>(undefined)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const at = new Date().toISOString()
      const [
        recoveryState,
        diagnosticRecords,
        importSnapshot,
        portableImportSnapshot
      ] = await Promise.all([
        recovery.inspect(at),
        diagnostics.list(),
        database.readImportSnapshot(),
        database.readPortableImportSnapshot()
      ])
      setState({
        status: 'ready',
        diagnostics: diagnosticRecords,
        importSnapshotAvailable: importSnapshot !== undefined,
        portableImportSnapshotAvailable: portableImportSnapshot !== undefined,
        recovery: recoveryState
      })
    } catch {
      setState({ status: 'error' })
    }
  }, [database, diagnostics, recovery])

  const recordUncertainResponse = useCallback(
    async (occurredAt: string) => {
      await diagnostics
        .record('operation-response-uncertain', {
          occurredAt,
          scopeKey: 'profile'
        })
        .catch(() => undefined)
      await load()
    },
    [diagnostics, load]
  )

  const exportPortablePlaintext = useCallback(async () => {
    setPending(true)
    try {
      return await portability.exportPlaintext(new Date().toISOString())
    } finally {
      setPending(false)
    }
  }, [portability])

  const exportPortableEncrypted = useCallback(
    async (passphrase: string) => {
      setPending(true)
      try {
        return await portability.exportEncrypted({
          createdAt: new Date().toISOString(),
          passphrase
        })
      } finally {
        setPending(false)
      }
    },
    [portability]
  )

  const previewPortableImport = useCallback(
    async (raw: string, passphrase?: string) => {
      setPending(true)
      try {
        return await portability.preview(raw, passphrase)
      } finally {
        setPending(false)
      }
    },
    [portability]
  )

  const resolvePortableConflicts = useCallback(
    async (
      preview: PortableImportPreview,
      resolutions: readonly SyncConflictResolution[]
    ) => {
      setPending(true)
      try {
        return await portability.resolve(preview, resolutions)
      } finally {
        setPending(false)
      }
    },
    [portability]
  )

  const applyPortableReplace = useCallback(
    async (preview: PortableImportPreview): Promise<DataMutationOutcome> => {
      setPending(true)
      let intent = portableImportIntents.current.get(preview)
      if (!intent) {
        intent = createIntent()
        portableImportIntents.current.set(preview, intent)
      }
      try {
        const result = await portability.replace(preview, intent)
        if (result.state === 'pending') {
          return 'pending'
        }
        if (result.state !== 'imported') {
          portableImportIntents.current.delete(preview)
          return 'failed'
        }
        await onProfileChanged()
        await load()
        portableImportIntents.current.delete(preview)
        return 'committed'
      } catch {
        await recordUncertainResponse(intent.at)
        return 'pending'
      } finally {
        setPending(false)
      }
    },
    [load, onProfileChanged, portability, recordUncertainResponse]
  )

  const applyPortableMerge = useCallback(
    async (preview: PortableImportPreview): Promise<DataMutationOutcome> => {
      setPending(true)
      let intent = portableMergeIntents.current.get(preview)
      if (!intent) {
        intent = createIntent()
        portableMergeIntents.current.set(preview, intent)
      }
      try {
        const result = await portability.merge(preview, intent)
        if (result.state === 'pending') {
          return 'pending'
        }
        if (result.state !== 'imported') {
          portableMergeIntents.current.delete(preview)
          return 'failed'
        }
        await onProfileChanged()
        await load()
        portableMergeIntents.current.delete(preview)
        return 'committed'
      } catch {
        await recordUncertainResponse(intent.at)
        return 'pending'
      } finally {
        setPending(false)
      }
    },
    [load, onProfileChanged, portability, recordUncertainResponse]
  )

  const restorePortableImportSnapshot =
    useCallback(async (): Promise<DataMutationOutcome> => {
      setPending(true)
      const intent = portableRestoreIntent.current ?? createIntent()
      portableRestoreIntent.current = intent
      try {
        const result = await database.restorePortableImportSnapshot(intent)
        if (result.state === 'pending') {
          return 'pending'
        }
        if (result.state !== 'restored') {
          portableRestoreIntent.current = undefined
          return 'failed'
        }
        await onProfileChanged()
        await load()
        portableRestoreIntent.current = undefined
        return 'committed'
      } catch {
        await recordUncertainResponse(intent.at)
        return 'pending'
      } finally {
        setPending(false)
      }
    }, [database, load, onProfileChanged, recordUncertainResponse])

  useEffect(() => {
    void load()
  }, [load])

  const exportProfile = useCallback(async () => {
    setPending(true)
    try {
      return await database.exportProfile()
    } finally {
      setPending(false)
    }
  }, [database])

  const previewImport = useCallback(
    async (raw: string): Promise<ImportPreview> => {
      setPending(true)
      try {
        const at = new Date().toISOString()
        const result = await database.importProfile(raw, {
          mode: 'dry-run',
          at
        })
        if (result.state !== 'valid') {
          await diagnostics
            .record('import-invalid', {
              occurredAt: at,
              scopeKey: 'profile'
            })
            .catch(() => undefined)
          return { ok: false }
        }
        return { ok: true, raw, summary: result.summary }
      } finally {
        setPending(false)
      }
    },
    [database, diagnostics]
  )

  const applyImport = useCallback(
    async (
      preview: Extract<ImportPreview, { ok: true }>
    ): Promise<DataMutationOutcome> => {
      setPending(true)
      let intent = importIntents.current.get(preview)
      if (!intent) {
        intent = createIntent()
        importIntents.current.set(preview, intent)
      }
      try {
        const result = await database.importProfile(preview.raw, {
          mode: 'replace',
          ...intent
        })
        if (result.state === 'pending') {
          return 'pending'
        }
        if (result.state !== 'imported') {
          await diagnostics
            .record('import-failed', {
              occurredAt: intent.at,
              scopeKey: 'profile'
            })
            .catch(() => undefined)
          importIntents.current.delete(preview)
          return 'failed'
        }
        await onProfileChanged()
        await load()
        importIntents.current.delete(preview)
        return 'committed'
      } catch {
        await diagnostics
          .record('operation-response-uncertain', {
            occurredAt: intent.at,
            scopeKey: 'profile'
          })
          .catch(() => undefined)
        await load()
        return 'pending'
      } finally {
        setPending(false)
      }
    },
    [database, diagnostics, load, onProfileChanged]
  )

  const exportDiagnostics = useCallback(async () => {
    setPending(true)
    try {
      return await diagnostics.export(new Date().toISOString())
    } finally {
      setPending(false)
    }
  }, [diagnostics])

  const clearDiagnostics = useCallback(async () => {
    setPending(true)
    try {
      await diagnostics.clear()
      await load()
      return true
    } catch {
      return false
    } finally {
      setPending(false)
    }
  }, [diagnostics, load])

  const restore = useCallback(async (): Promise<DataMutationOutcome> => {
    setPending(true)
    const intent = migrationRestoreIntent.current ?? createIntent()
    migrationRestoreIntent.current = intent
    try {
      const result = await database.restoreMigrationSnapshot(intent)
      if (result.state === 'pending') {
        return 'pending'
      }
      if (result.state !== 'restored') {
        await diagnostics
          .record('recovery-restore-failed', {
            occurredAt: intent.at,
            scopeKey: 'profile'
          })
          .catch(() => undefined)
        migrationRestoreIntent.current = undefined
        return 'failed'
      }
      await onProfileChanged()
      await load()
      migrationRestoreIntent.current = undefined
      return 'committed'
    } catch {
      await recordUncertainResponse(intent.at)
      return 'pending'
    } finally {
      setPending(false)
    }
  }, [database, diagnostics, load, onProfileChanged, recordUncertainResponse])

  const restoreImportSnapshot =
    useCallback(async (): Promise<DataMutationOutcome> => {
      setPending(true)
      const intent = importRestoreIntent.current ?? createIntent()
      importRestoreIntent.current = intent
      try {
        const result = await database.restoreImportSnapshot(intent)
        if (result.state === 'pending') {
          return 'pending'
        }
        if (result.state !== 'restored') {
          await diagnostics
            .record('recovery-restore-failed', {
              occurredAt: intent.at,
              scopeKey: 'profile'
            })
            .catch(() => undefined)
          importRestoreIntent.current = undefined
          return 'failed'
        }
        await onProfileChanged()
        await load()
        importRestoreIntent.current = undefined
        return 'committed'
      } catch {
        await recordUncertainResponse(intent.at)
        return 'pending'
      } finally {
        setPending(false)
      }
    }, [database, diagnostics, load, onProfileChanged, recordUncertainResponse])

  const reset = useCallback(async (): Promise<DataMutationOutcome> => {
    setPending(true)
    const at = new Date().toISOString()
    try {
      const result = await recovery.reset({ confirmed: true })
      if (result.state !== 'reset') {
        await diagnostics
          .record('local-reset-failed', {
            occurredAt: at,
            scopeKey: 'profile'
          })
          .catch(() => undefined)
        return 'failed'
      }
      await onProfileChanged()
      await load()
      return 'committed'
    } catch {
      await diagnostics
        .record('operation-response-uncertain', {
          occurredAt: at,
          scopeKey: 'profile'
        })
        .catch(() => undefined)
      const inspected = await recovery.inspect(at).catch(() => undefined)
      const reconciled = inspected?.state === 'blocked-unreadable'
      if (!reconciled && inspected) {
        await diagnostics
          .record('local-reset-failed', {
            occurredAt: at,
            scopeKey: 'profile'
          })
          .catch(() => undefined)
      }
      await load()
      return reconciled ? 'committed' : 'failed'
    } finally {
      setPending(false)
    }
  }, [diagnostics, load, onProfileChanged, recovery])

  return {
    applyPortableMerge,
    applyPortableReplace,
    applyImport,
    clearDiagnostics,
    exportDiagnostics,
    exportPortableEncrypted,
    exportPortablePlaintext,
    exportProfile,
    load,
    pending,
    previewImport,
    previewPortableImport,
    reset,
    resolvePortableConflicts,
    restore,
    restoreImportSnapshot,
    restorePortableImportSnapshot,
    state
  }
}
