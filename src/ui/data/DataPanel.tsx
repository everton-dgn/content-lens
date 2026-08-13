import { type ChangeEvent, useEffect, useRef, useState } from 'react'

import type { PortableImportPreview } from '@/application/import-export/service'
import type { DiagnosticService } from '@/diagnostics/service'
import type { ContentLensDatabase } from '@/storage/indexed-db/database'
import type { SyncConflictResolution } from '@/sync/conflict-resolution'
import {
  BackAction,
  Badge,
  Button,
  ChoiceGroup,
  FileField,
  Notice,
  SecretField,
  StatePanel,
  Surface
} from '@/ui/components'
import type { DataPanelCopy } from '@/ui/data/copy'
import {
  type PortableConflictDraft,
  PortableConflictEditor
} from '@/ui/data/PortableConflictEditor'
import { downloadJson, serializeDiagnosticExport } from '@/ui/data/portability'
import { useDataTools } from '@/ui/data/useDataTools'

export type DataPanelProps = {
  copy: DataPanelCopy
  database: ContentLensDatabase
  diagnostics: DiagnosticService
  onBack: () => void
  onProfileChanged: () => Promise<void>
}

type Feedback =
  | { kind: 'import-success' }
  | { kind: 'import-restore-success' }
  | { kind: 'import-invalid' }
  | {
      kind: 'pending'
      operation:
        | 'import'
        | 'import-restore'
        | 'migration-restore'
        | 'portable-restore'
    }
  | { kind: 'error' }

export const DataPanel = ({
  copy,
  database,
  diagnostics,
  onBack,
  onProfileChanged
}: DataPanelProps) => {
  const tools = useDataTools({ database, diagnostics, onProfileChanged })
  const [importPreview, setImportPreview] = useState<PortableImportPreview>()
  const [importRaw, setImportRaw] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [importPassphraseRequired, setImportPassphraseRequired] =
    useState(false)
  const [exportMode, setExportMode] = useState<'encrypted' | 'plaintext'>(
    'encrypted'
  )
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [exportPassphraseConfirmation, setExportPassphraseConfirmation] =
    useState('')
  const [exportPassphraseError, setExportPassphraseError] = useState(false)
  const [confirmPlaintextExport, setConfirmPlaintextExport] = useState(false)
  const [confirmPortableReplace, setConfirmPortableReplace] = useState(false)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('replace')
  const [conflictDrafts, setConflictDrafts] = useState<
    Record<string, PortableConflictDraft>
  >({})
  const [conflictResolutionError, setConflictResolutionError] = useState(false)
  const [bulkConflictReview, setBulkConflictReview] = useState<
    'local' | 'remote' | undefined
  >()
  const [feedback, setFeedback] = useState<Feedback>()
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmDiagnosticExport, setConfirmDiagnosticExport] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const focusAfterClose = useRef<'clear' | 'diagnostics' | 'reset' | undefined>(
    undefined
  )

  useEffect(() => {
    if (confirmClear || confirmDiagnosticExport || confirmReset) {
      return
    }
    const target = focusAfterClose.current
    if (!target) {
      return
    }
    panelRef.current
      ?.querySelector<HTMLButtonElement>(`[data-focus-return="${target}"]`)
      ?.focus()
    focusAfterClose.current = undefined
  }, [confirmClear, confirmDiagnosticExport, confirmReset])

  const exportEncryptedProfile = async () => {
    const valid =
      new TextEncoder().encode(exportPassphrase).byteLength >= 12 &&
      exportPassphrase === exportPassphraseConfirmation
    setExportPassphraseError(!valid)
    if (!valid) {
      return
    }
    try {
      const serialized = await tools.exportPortableEncrypted(exportPassphrase)
      downloadJson(serialized, 'contentlens-profile.encrypted.json')
      setExportPassphrase('')
      setExportPassphraseConfirmation('')
    } catch {
      setFeedback({ kind: 'error' })
    }
  }
  const exportPlaintextProfile = async () => {
    try {
      const serialized = await tools.exportPortablePlaintext()
      downloadJson(serialized, 'contentlens-profile.json')
      setConfirmPlaintextExport(false)
    } catch {
      setFeedback({ kind: 'error' })
    }
  }
  const changeExportMode = (value: 'encrypted' | 'plaintext') => {
    setExportMode(value)
    setConfirmPlaintextExport(false)
    setExportPassphraseError(false)
  }
  const changeExportPassphrase = (value: string) => {
    setExportPassphrase(value)
    setExportPassphraseError(false)
  }
  const changeExportPassphraseConfirmation = (value: string) => {
    setExportPassphraseConfirmation(value)
    setExportPassphraseError(false)
  }
  const cancelPlaintextExport = () => setConfirmPlaintextExport(false)
  const reviewPlaintextExport = () => setConfirmPlaintextExport(true)
  const changeImportMode = (value: 'merge' | 'replace') => {
    setImportMode(value)
    setConfirmPortableReplace(false)
  }
  const cancelPortableImport = () => setConfirmPortableReplace(false)
  const reviewPortableImport = () => setConfirmPortableReplace(true)
  const changeConflictDraft = (
    entityType: string,
    entityId: string,
    draft: PortableConflictDraft
  ) => {
    setConflictDrafts(current => ({
      ...current,
      [`${entityType}\u0000${entityId}`]: draft
    }))
    setConflictResolutionError(false)
  }
  const reviewAllLocalConflicts = () => setBulkConflictReview('local')
  const reviewAllRemoteConflicts = () => setBulkConflictReview('remote')
  const cancelBulkConflictResolution = () => setBulkConflictReview(undefined)
  const applyBulkConflictResolution = () => {
    if (!bulkConflictReview || importPreview?.merge.state !== 'conflict') {
      return
    }
    setConflictDrafts(
      Object.fromEntries(
        importPreview.merge.conflicts.map(conflict => [
          `${conflict.entityType}\u0000${conflict.entityId}`,
          { choice: bulkConflictReview, customValue: '' }
        ])
      )
    )
    setBulkConflictReview(undefined)
    setConflictResolutionError(false)
  }
  const resolveConflicts = async () => {
    if (importPreview?.merge.state !== 'conflict') {
      return
    }
    const resolutions: SyncConflictResolution[] = []
    let invalid = false
    const nextDrafts = { ...conflictDrafts }
    for (const conflict of importPreview.merge.conflicts) {
      if (conflict.entityType === 'envelope') {
        invalid = true
        continue
      }
      const key = `${conflict.entityType}\u0000${conflict.entityId}`
      const draft = conflictDrafts[key]
      if (!draft || draft.choice === 'unselected') {
        invalid = true
        continue
      }
      let customValue: unknown
      if (draft.choice === 'custom') {
        try {
          customValue = JSON.parse(draft.customValue)
        } catch {
          invalid = true
          nextDrafts[key] = { ...draft, error: copy.importConflictJsonError }
          continue
        }
      }
      resolutions.push({
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        choice: draft.choice,
        customValue
      })
    }
    setConflictDrafts(nextDrafts)
    if (invalid) {
      setConflictResolutionError(true)
      return
    }
    const resolved = await tools.resolvePortableConflicts(
      importPreview,
      resolutions
    )
    if (resolved.state !== 'resolved') {
      setConflictResolutionError(true)
      return
    }
    setImportPreview(resolved.preview)
    setImportMode('merge')
    setConflictDrafts({})
    setConflictResolutionError(false)
  }
  const acceptPortablePreview = (
    result: Awaited<ReturnType<typeof tools.previewPortableImport>>
  ) => {
    if (result.state === 'passphrase-required') {
      setImportPreview(undefined)
      setImportPassphraseRequired(true)
      setFeedback(undefined)
      return
    }
    if (result.state !== 'preview') {
      setImportPreview(undefined)
      setImportPassphraseRequired(false)
      setFeedback({ kind: 'import-invalid' })
      return
    }
    setFeedback(undefined)
    setImportPassphraseRequired(false)
    setImportPreview(result.preview)
    setImportMode(result.preview.merge.state === 'ready' ? 'merge' : 'replace')
    setConflictResolutionError(false)
    setBulkConflictReview(undefined)
    setConflictDrafts(
      result.preview.merge.state === 'conflict'
        ? Object.fromEntries(
            result.preview.merge.conflicts.map(conflict => [
              `${conflict.entityType}\u0000${conflict.entityId}`,
              { choice: 'unselected', customValue: '' }
            ])
          )
        : {}
    )
  }
  const selectImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      return
    }
    const raw = await file.text()
    setImportRaw(raw)
    setImportPassphrase('')
    setConfirmPortableReplace(false)
    acceptPortablePreview(await tools.previewPortableImport(raw))
  }
  const unlockImport = async () => {
    acceptPortablePreview(
      await tools.previewPortableImport(importRaw, importPassphrase)
    )
  }
  const applyImport = async () => {
    if (!importPreview) {
      return
    }
    const imported =
      importMode === 'merge'
        ? await tools.applyPortableMerge(importPreview)
        : await tools.applyPortableReplace(importPreview)
    setFeedback(
      imported === 'committed'
        ? { kind: 'import-success' }
        : imported === 'pending'
          ? { kind: 'pending', operation: 'import' }
          : { kind: 'error' }
    )
    if (imported === 'committed') {
      setImportPreview(undefined)
      setImportRaw('')
      setImportPassphrase('')
      setConfirmPortableReplace(false)
    }
  }
  const exportDiagnostics = async () => {
    const exported = await tools.exportDiagnostics()
    downloadJson(
      serializeDiagnosticExport(exported),
      'contentlens-diagnostics.json'
    )
    setConfirmDiagnosticExport(false)
  }
  const clearDiagnostics = async () => {
    const cleared = await tools.clearDiagnostics()
    setConfirmClear(false)
    if (!cleared) {
      setFeedback({ kind: 'error' })
    }
  }
  const restore = async () => {
    const restored = await tools.restore()
    setFeedback(
      restored === 'committed'
        ? undefined
        : restored === 'pending'
          ? { kind: 'pending', operation: 'migration-restore' }
          : { kind: 'error' }
    )
  }
  const restoreImportSnapshot = async () => {
    const restored = await tools.restoreImportSnapshot()
    setFeedback(
      restored === 'committed'
        ? { kind: 'import-restore-success' }
        : restored === 'pending'
          ? { kind: 'pending', operation: 'import-restore' }
          : { kind: 'error' }
    )
  }
  const restorePortableImportSnapshot = async () => {
    const restored = await tools.restorePortableImportSnapshot()
    setFeedback(
      restored === 'committed'
        ? { kind: 'import-restore-success' }
        : restored === 'pending'
          ? { kind: 'pending', operation: 'portable-restore' }
          : { kind: 'error' }
    )
  }
  const reset = async () => {
    const resetComplete = await tools.reset()
    setConfirmReset(false)
    if (resetComplete !== 'committed') {
      setFeedback({ kind: 'error' })
    }
  }
  const reviewClear = () => {
    setConfirmDiagnosticExport(false)
    setConfirmReset(false)
    setConfirmClear(true)
  }
  const cancelClear = () => {
    focusAfterClose.current = 'clear'
    setConfirmClear(false)
  }
  const reviewDiagnosticExport = () => {
    setConfirmClear(false)
    setConfirmReset(false)
    setConfirmDiagnosticExport(true)
  }
  const cancelDiagnosticExport = () => {
    focusAfterClose.current = 'diagnostics'
    setConfirmDiagnosticExport(false)
  }
  const reviewReset = () => {
    setConfirmClear(false)
    setConfirmDiagnosticExport(false)
    setConfirmReset(true)
  }
  const cancelReset = () => {
    focusAfterClose.current = 'reset'
    setConfirmReset(false)
  }

  if (tools.state.status === 'loading') {
    return (
      <StatePanel
        description={copy.pending}
        eyebrow={copy.eyebrow}
        state="loading"
        title={copy.title}
      />
    )
  }
  if (tools.state.status === 'error') {
    return (
      <StatePanel
        description={copy.errorBody}
        eyebrow={copy.eyebrow}
        primaryAction={
          <Button onClick={tools.load} size="full">
            {copy.retryAction}
          </Button>
        }
        state="error"
        title={copy.errorTitle}
      />
    )
  }

  const recoveryLabel =
    tools.state.recovery.state === 'recoverable'
      ? copy.recoveryRecoverable
      : tools.state.recovery.state === 'readable'
        ? copy.recoveryReadable
        : copy.recoveryBlocked
  const reviewOpen =
    confirmClear ||
    confirmDiagnosticExport ||
    confirmReset ||
    confirmPlaintextExport ||
    confirmPortableReplace
  const conflictsResolvable =
    importPreview?.merge.state === 'conflict' &&
    importPreview.merge.conflicts.every(
      conflict => conflict.entityType !== 'envelope'
    )

  return (
    <section
      aria-busy={tools.pending}
      className="data-panel"
      data-slot="data-panel"
      ref={panelRef}
    >
      <div className="data-panel__header" data-slot="subpage-header">
        <BackAction label={copy.backAction} onClick={onBack} />
        <div className="rule-workbench__heading">
          <p>{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <span>{copy.description}</span>
        </div>
      </div>

      {feedback?.kind === 'import-success' ? (
        <Notice
          body={copy.importSuccessBody}
          title={copy.importSuccessTitle}
          tone="success"
        />
      ) : null}
      {feedback?.kind === 'import-invalid' ? (
        <Notice
          body={copy.importInvalidBody}
          title={copy.importInvalidTitle}
          tone="degraded"
        />
      ) : null}
      {feedback?.kind === 'import-restore-success' ? (
        <Notice
          body={copy.importRestoreSuccessBody}
          title={copy.importRestoreSuccessTitle}
          tone="success"
        />
      ) : null}
      {feedback?.kind === 'error' ? (
        <Notice body={copy.errorBody} title={copy.errorTitle} tone="error" />
      ) : null}
      {feedback?.kind === 'pending' ? (
        <Notice body={copy.pendingBody} title={copy.pendingTitle} tone="info" />
      ) : null}

      <Surface elevation="raised">
        <div className="data-section">
          <h3>{copy.capabilityTitle}</h3>
          <div className="data-capability">
            <Badge tone="success">{copy.localLabel}</Badge>
            <div>
              <strong>{copy.baselineCapability}</strong>
              <span>{copy.baselineCapabilityDetail}</span>
            </div>
          </div>
          <div className="data-capability">
            <Badge tone="success">{copy.localLabel}</Badge>
            <div>
              <strong>{copy.storageCapability}</strong>
              <span>{copy.storageCapabilityDetail}</span>
            </div>
          </div>
          <div className="data-capability">
            <Badge tone="neutral">{copy.optionalLabel}</Badge>
            <div>
              <strong>{copy.optionalCapability}</strong>
              <span>{copy.optionalCapabilityDetail}</span>
            </div>
          </div>
        </div>
      </Surface>

      <Surface>
        <div className="data-section">
          <h3>{copy.profileTitle}</h3>
          <p>{copy.profileDescription}</p>
          <ChoiceGroup
            label={copy.exportProtectionLabel}
            name="portable-export-protection"
            onChange={changeExportMode}
            options={[
              {
                value: 'encrypted',
                label: copy.exportEncryptedLabel,
                description: copy.exportEncryptedDescription
              },
              {
                value: 'plaintext',
                label: copy.exportPlaintextLabel,
                description: copy.exportPlaintextDescription
              }
            ]}
            value={exportMode}
          />
          {exportMode === 'encrypted' ? (
            <div className="data-review">
              <Notice
                body={copy.exportPassphraseWarningBody}
                title={copy.exportPassphraseWarningTitle}
                tone="info"
              />
              <SecretField
                autoComplete="new-password"
                error={
                  exportPassphraseError
                    ? copy.exportPassphraseMismatchError
                    : undefined
                }
                hint={copy.exportPassphraseHint}
                hideLabel={copy.hideSecretAction}
                label={copy.exportPassphraseLabel}
                onChange={changeExportPassphrase}
                revealLabel={copy.revealSecretAction}
                value={exportPassphrase}
              />
              <SecretField
                autoComplete="new-password"
                hideLabel={copy.hideSecretAction}
                label={copy.exportPassphraseConfirmationLabel}
                onChange={changeExportPassphraseConfirmation}
                revealLabel={copy.revealSecretAction}
                value={exportPassphraseConfirmation}
              />
              <Button
                disabled={tools.pending}
                onClick={exportEncryptedProfile}
                size="full"
                variant={
                  tools.state.recovery.state === 'recoverable' ||
                  reviewOpen ||
                  importPassphraseRequired ||
                  importPreview
                    ? 'secondary'
                    : 'primary'
                }
              >
                {copy.exportEncryptedAction}
              </Button>
            </div>
          ) : confirmPlaintextExport ? (
            <div className="data-review">
              <Notice
                body={copy.exportPlaintextReviewBody}
                title={copy.exportPlaintextReviewTitle}
                tone="degraded"
              />
              <div className="data-actions">
                <Button
                  disabled={tools.pending}
                  onClick={exportPlaintextProfile}
                  size="full"
                >
                  {copy.exportPlaintextConfirmAction}
                </Button>
                <Button
                  autoFocus
                  disabled={tools.pending}
                  onClick={cancelPlaintextExport}
                  size="full"
                  variant="quiet"
                >
                  {copy.cancelAction}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              disabled={tools.pending}
              onClick={reviewPlaintextExport}
              size="full"
              variant="secondary"
            >
              {copy.exportPlaintextReviewAction}
            </Button>
          )}
          <FileField
            accept="application/json,.json"
            actionLabel={copy.chooseFileAction}
            disabled={tools.pending}
            emptyLabel={copy.noFileSelected}
            hint={copy.importHint}
            label={copy.importLabel}
            onChange={selectImport}
          />
          {importPassphraseRequired ? (
            <div className="data-review">
              <Notice
                body={copy.importEncryptedBody}
                title={copy.importEncryptedTitle}
                tone="info"
              />
              <SecretField
                autoComplete="current-password"
                hideLabel={copy.hideSecretAction}
                label={copy.importPassphraseLabel}
                onChange={setImportPassphrase}
                revealLabel={copy.revealSecretAction}
                value={importPassphrase}
              />
              <Button
                disabled={tools.pending || importPassphrase.length === 0}
                onClick={unlockImport}
                size="full"
              >
                {copy.importUnlockAction}
              </Button>
            </div>
          ) : null}
          {importPreview ? (
            <div className="data-import-preview">
              <strong>{copy.importPreviewTitle}</strong>
              <dl>
                <div>
                  <dt>{copy.importAddedLabel}</dt>
                  <dd>{importPreview.changes.totals.added}</dd>
                </div>
                <div>
                  <dt>{copy.importChangedLabel}</dt>
                  <dd>{importPreview.changes.totals.changed}</dd>
                </div>
                <div>
                  <dt>{copy.importRemovedLabel}</dt>
                  <dd>{importPreview.changes.totals.removed}</dd>
                </div>
                <div>
                  <dt>{copy.importTombstonesLabel}</dt>
                  <dd>{importPreview.changes.tombstones}</dd>
                </div>
              </dl>
              {importPreview.merge.state === 'ready' ? (
                <Notice
                  body={copy.importMergeReadyBody}
                  title={copy.importMergeReadyTitle}
                  tone="success"
                />
              ) : importPreview.merge.state === 'conflict' ? (
                <Notice
                  body={copy.importMergeConflictBody.replace(
                    '{count}',
                    String(importPreview.merge.conflicts.length)
                  )}
                  title={copy.importMergeConflictTitle}
                  tone="degraded"
                />
              ) : (
                <Notice
                  body={copy.importMergeUnavailableBody}
                  title={copy.importMergeUnavailableTitle}
                  tone="info"
                />
              )}
              {conflictsResolvable &&
              importPreview.merge.state === 'conflict' ? (
                <div className="data-conflict-list">
                  {conflictResolutionError ? (
                    <Notice
                      body={copy.importConflictResolutionErrorBody}
                      title={copy.importConflictResolutionErrorTitle}
                      tone="error"
                    />
                  ) : null}
                  {importPreview.merge.conflicts.map(conflict => (
                    <PortableConflictEditor
                      conflict={conflict}
                      copy={copy}
                      draft={
                        conflictDrafts[
                          `${conflict.entityType}\u0000${conflict.entityId}`
                        ] ?? { choice: 'unselected', customValue: '' }
                      }
                      key={`${conflict.entityType}:${conflict.entityId}`}
                      onChange={changeConflictDraft}
                    />
                  ))}
                  {bulkConflictReview ? (
                    <div className="data-review">
                      <Notice
                        body={
                          bulkConflictReview === 'local'
                            ? copy.importConflictAllLocalReviewBody
                            : copy.importConflictAllRemoteReviewBody
                        }
                        title={copy.importConflictBulkReviewTitle}
                        tone="degraded"
                      />
                      <div className="data-actions">
                        <Button
                          disabled={tools.pending}
                          onClick={applyBulkConflictResolution}
                          size="full"
                        >
                          {copy.importConflictBulkConfirmAction}
                        </Button>
                        <Button
                          autoFocus
                          disabled={tools.pending}
                          onClick={cancelBulkConflictResolution}
                          size="full"
                          variant="quiet"
                        >
                          {copy.cancelAction}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="data-actions">
                      <Button
                        disabled={tools.pending}
                        onClick={reviewAllLocalConflicts}
                        size="full"
                        variant="secondary"
                      >
                        {copy.importConflictAllLocalAction}
                      </Button>
                      <Button
                        disabled={tools.pending}
                        onClick={reviewAllRemoteConflicts}
                        size="full"
                        variant="secondary"
                      >
                        {copy.importConflictAllRemoteAction}
                      </Button>
                    </div>
                  )}
                  <Button
                    disabled={tools.pending || bulkConflictReview !== undefined}
                    onClick={resolveConflicts}
                    size="full"
                  >
                    {copy.importConflictValidateAction}
                  </Button>
                </div>
              ) : null}
              <ChoiceGroup
                label={copy.importModeLabel}
                name="portable-import-mode"
                onChange={changeImportMode}
                options={[
                  ...(importPreview.merge.state === 'ready'
                    ? [
                        {
                          value: 'merge' as const,
                          label: copy.importMergeLabel,
                          description: copy.importMergeDescription
                        }
                      ]
                    : []),
                  {
                    value: 'replace' as const,
                    label: copy.importReplaceLabel,
                    description: copy.importReplaceDescription
                  }
                ]}
                value={importMode}
              />
              {confirmPortableReplace ? (
                <div className="data-review">
                  <Notice
                    body={
                      importMode === 'merge'
                        ? copy.importMergeReviewBody
                        : copy.importReplaceReviewBody
                    }
                    title={
                      importMode === 'merge'
                        ? copy.importMergeReviewTitle
                        : copy.importReplaceReviewTitle
                    }
                    tone="degraded"
                  />
                  <div className="data-actions">
                    <Button
                      disabled={tools.pending}
                      onClick={applyImport}
                      size="full"
                    >
                      {feedback?.kind === 'pending' &&
                      feedback.operation === 'import'
                        ? copy.pendingAction
                        : importMode === 'merge'
                          ? copy.applyMergeAction
                          : copy.applyImportAction}
                    </Button>
                    <Button
                      autoFocus
                      disabled={tools.pending}
                      onClick={cancelPortableImport}
                      size="full"
                      variant="quiet"
                    >
                      {copy.cancelAction}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  disabled={tools.pending}
                  onClick={reviewPortableImport}
                  size="full"
                  variant={
                    reviewOpen || conflictsResolvable ? 'secondary' : 'primary'
                  }
                >
                  {importMode === 'merge'
                    ? copy.importMergeReviewAction
                    : copy.importReplaceReviewAction}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </Surface>

      <Surface>
        <div className="data-section">
          <h3>{copy.diagnosticsTitle}</h3>
          <p>{copy.diagnosticsDescription}</p>
          <div className="data-stat">
            {tools.state.diagnostics.length > 0 ? (
              <strong>{tools.state.diagnostics.length}</strong>
            ) : null}
            <span>
              {tools.state.diagnostics.length === 0
                ? copy.noDiagnostics
                : copy.diagnosticsCountLabel}
            </span>
          </div>
          {confirmDiagnosticExport ? (
            <div className="data-review">
              <Notice
                body={copy.diagnosticsExportReviewBody}
                title={copy.diagnosticsExportReviewTitle}
                tone="degraded"
              />
              <div className="data-actions">
                <Button
                  disabled={tools.pending}
                  onClick={exportDiagnostics}
                  size="full"
                >
                  {copy.confirmDiagnosticsExportAction}
                </Button>
                <Button
                  autoFocus
                  disabled={tools.pending}
                  onClick={cancelDiagnosticExport}
                  size="full"
                  variant="quiet"
                >
                  {copy.cancelAction}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              data-focus-return="diagnostics"
              disabled={tools.pending}
              onClick={reviewDiagnosticExport}
              size="full"
              variant="secondary"
            >
              {copy.reviewDiagnosticsExportAction}
            </Button>
          )}
          {confirmClear ? (
            <div className="data-review">
              <Notice
                body={copy.clearDiagnosticsReviewBody}
                title={copy.clearDiagnosticsReviewTitle}
                tone="degraded"
              />
              <div className="data-actions">
                <Button
                  disabled={tools.pending}
                  onClick={clearDiagnostics}
                  size="full"
                  variant="danger"
                >
                  {copy.confirmClearDiagnosticsAction}
                </Button>
                <Button
                  autoFocus
                  disabled={tools.pending}
                  onClick={cancelClear}
                  size="full"
                  variant="quiet"
                >
                  {copy.cancelAction}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              data-focus-return="clear"
              disabled={tools.pending}
              onClick={reviewClear}
              size="full"
              variant="secondary"
            >
              {copy.clearDiagnosticsAction}
            </Button>
          )}
        </div>
      </Surface>

      <Surface>
        <div className="data-section">
          <h3>{copy.recoveryTitle}</h3>
          <p>{copy.recoveryDescription}</p>
          <Badge
            tone={
              tools.state.recovery.state === 'blocked-unreadable'
                ? 'degraded'
                : 'success'
            }
          >
            {recoveryLabel}
          </Badge>
          {tools.state.recovery.state === 'recoverable' ? (
            <Button
              disabled={tools.pending}
              onClick={restore}
              size="full"
              variant={importPreview || reviewOpen ? 'secondary' : 'primary'}
            >
              {feedback?.kind === 'pending' &&
              feedback.operation === 'migration-restore'
                ? copy.pendingAction
                : copy.restoreAction}
            </Button>
          ) : null}
          {tools.state.importSnapshotAvailable ? (
            <div className="data-review">
              <Notice
                body={copy.importSnapshotBody}
                title={copy.importSnapshotTitle}
                tone="degraded"
              />
              <Button
                disabled={tools.pending}
                onClick={restoreImportSnapshot}
                size="full"
                variant="secondary"
              >
                {feedback?.kind === 'pending' &&
                feedback.operation === 'import-restore'
                  ? copy.pendingAction
                  : copy.restoreImportAction}
              </Button>
            </div>
          ) : null}
          {tools.state.portableImportSnapshotAvailable ? (
            <div className="data-review">
              <Notice
                body={copy.portableImportSnapshotBody}
                title={copy.portableImportSnapshotTitle}
                tone="degraded"
              />
              <Button
                disabled={tools.pending}
                onClick={restorePortableImportSnapshot}
                size="full"
                variant="secondary"
              >
                {feedback?.kind === 'pending' &&
                feedback.operation === 'portable-restore'
                  ? copy.pendingAction
                  : copy.restorePortableImportAction}
              </Button>
            </div>
          ) : null}
          <div className="data-reset">
            {confirmReset ? (
              <div className="data-review">
                <Notice
                  body={copy.resetWarningBody}
                  title={copy.resetWarningTitle}
                  tone="error"
                />
                <div className="data-actions">
                  <Button
                    disabled={tools.pending}
                    onClick={reset}
                    size="full"
                    variant="danger"
                  >
                    {copy.confirmResetAction}
                  </Button>
                  <Button
                    autoFocus
                    disabled={tools.pending}
                    onClick={cancelReset}
                    size="full"
                    variant="quiet"
                  >
                    {copy.cancelAction}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                data-focus-return="reset"
                disabled={tools.pending}
                onClick={reviewReset}
                size="full"
                variant="secondary"
              >
                {copy.reviewResetAction}
              </Button>
            )}
          </div>
        </div>
      </Surface>
    </section>
  )
}
