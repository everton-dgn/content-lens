// biome-ignore-all lint/performance/noJsxPropsBind: controlled sync fields need current form and connection state.
import { useEffect, useMemo, useState } from 'react'

import type { ProviderDescriptor } from '@/ai/providers/contracts'
import type {
  SyncConflictView,
  SyncRecoveryView
} from '@/application/settings/runtime-contracts'
import type { SyncConflictResolution } from '@/sync/conflict-resolution'
import type { SyncConnection } from '@/sync/connection'
import {
  Badge,
  Button,
  Field,
  Notice,
  SelectField,
  ToggleField
} from '@/ui/components'
import type { SettingsPanelCopy } from '@/ui/settings/copy'
import type { SettingsRuntimeClient } from '@/ui/settings/runtime'

type SyncSettingsSectionProps = {
  connection: SyncConnection
  conflict: SyncConflictView | null
  copy: SettingsPanelCopy
  onRefresh(): Promise<unknown>
  providers: ProviderDescriptor[]
  recoveries: SyncRecoveryView[]
  runtime: SettingsRuntimeClient
}

type SyncFeedback =
  | { tone: 'success' | 'degraded' | 'error'; title: string; body: string }
  | undefined

export const SyncSettingsSection = ({
  connection,
  conflict,
  copy,
  onRefresh,
  providers,
  recoveries,
  runtime
}: SyncSettingsSectionProps) => {
  const eligibleProviders = useMemo(
    () => providers.filter(provider => provider.execution !== 'browser'),
    [providers]
  )
  const [providerConfigId, setProviderConfigId] = useState(
    connection.providerConfigId ?? eligibleProviders[0]?.providerConfigId ?? ''
  )
  const [endpointPath, setEndpointPath] = useState(
    connection.endpointPath ?? '/contentlens/profile.json'
  )
  const [remoteObjectId, setRemoteObjectId] = useState(
    connection.remoteObjectId ?? 'profile.json'
  )
  const [schedule, setSchedule] = useState(
    String(connection.scheduleMinutes ?? 15)
  )
  const [retention, setRetention] = useState(
    connection.retention ?? copy.syncRetentionDefault
  )
  const [revocation, setRevocation] = useState(
    connection.revocation ?? copy.syncRevocationDefault
  )
  const [consented, setConsented] = useState(false)
  const [disconnectReview, setDisconnectReview] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<SyncFeedback>()
  const [conflictChoices, setConflictChoices] = useState<
    Record<string, { choice: 'local' | 'remote' | 'custom'; custom: string }>
  >({})
  const [bulkReview, setBulkReview] = useState<'local' | 'remote'>()
  const [recoveryReview, setRecoveryReview] = useState<string>()
  const [remoteDeleteReview, setRemoteDeleteReview] = useState(false)
  const [remoteDeleteConfirmation, setRemoteDeleteConfirmation] = useState('')

  useEffect(() => {
    setProviderConfigId(
      connection.providerConfigId ??
        eligibleProviders[0]?.providerConfigId ??
        ''
    )
    setEndpointPath(connection.endpointPath ?? '/contentlens/profile.json')
    setRemoteObjectId(connection.remoteObjectId ?? 'profile.json')
    setSchedule(String(connection.scheduleMinutes ?? 15))
    setRetention(connection.retention ?? copy.syncRetentionDefault)
    setRevocation(connection.revocation ?? copy.syncRevocationDefault)
  }, [
    connection,
    copy.syncRetentionDefault,
    copy.syncRevocationDefault,
    eligibleProviders
  ])

  useEffect(() => {
    const choices = Object.fromEntries(
      (conflict?.resolutions ?? []).map(resolution => [
        `${resolution.entityType}\u0000${resolution.entityId}`,
        {
          choice: resolution.choice,
          custom:
            resolution.choice === 'custom'
              ? JSON.stringify(resolution.customValue)
              : ''
        }
      ])
    )
    setConflictChoices(choices)
    setBulkReview(undefined)
  }, [conflict])

  const selectedProvider = eligibleProviders.find(
    provider => provider.providerConfigId === providerConfigId
  )
  const readyToConnect = Boolean(
    selectedProvider?.credentialRef &&
      endpointPath &&
      remoteObjectId &&
      retention &&
      revocation &&
      consented
  )

  const run = async (operation: () => Promise<void>) => {
    setPending(true)
    setFeedback(undefined)
    try {
      await operation()
    } catch {
      setFeedback({
        tone: 'error',
        title: copy.syncFailureTitle,
        body: copy.syncFailureBody
      })
    } finally {
      setPending(false)
    }
  }

  const connect = () =>
    void run(async () => {
      if (!selectedProvider || !readyToConnect) {
        throw new TypeError('Incomplete sync connection')
      }
      if (!(await runtime.requestProviderPermission(selectedProvider))) {
        setFeedback({
          tone: 'degraded',
          title: copy.syncPermissionTitle,
          body: copy.syncPermissionBody
        })
        return
      }
      const response = await runtime.request({
        type: 'sync.connect',
        providerConfigId,
        endpointPath,
        remoteObjectId,
        scheduleMinutes: Number(schedule),
        retention,
        revocation,
        consentedAt: new Date().toISOString()
      })
      if (response.kind !== 'sync-connect') {
        throw new TypeError('Unexpected sync connection response')
      }
      setFeedback(
        response.value.state === 'connected'
          ? {
              tone: 'success',
              title: copy.syncConnectedTitle,
              body: copy.syncConnectedBody
            }
          : {
              tone: 'degraded',
              title: copy.syncConflictTitle,
              body: copy.syncConflictBody
            }
      )
      await onRefresh()
    })

  const syncNow = () =>
    void run(async () => {
      const response = await runtime.request({
        type: 'sync.now',
        at: new Date().toISOString()
      })
      if (response.kind !== 'sync-run') {
        throw new TypeError('Unexpected sync run response')
      }
      setFeedback(
        response.value.state === 'confirmed'
          ? {
              tone: 'success',
              title: copy.syncCompletedTitle,
              body: copy.syncCompletedBody
            }
          : {
              tone: 'degraded',
              title: copy.syncConflictTitle,
              body: copy.syncConflictBody
            }
      )
      await onRefresh()
    })

  const disconnect = () =>
    void run(async () => {
      const response = await runtime.request({
        type: 'sync.disconnect',
        at: new Date().toISOString()
      })
      if (response.kind !== 'sync-disconnected') {
        throw new TypeError('Unexpected sync disconnect response')
      }
      setDisconnectReview(false)
      setConsented(false)
      setFeedback({
        tone: 'success',
        title: copy.syncDisconnectedTitle,
        body: copy.syncDisconnectedBody
      })
      await onRefresh()
    })

  const changeSchedule = (value: string) => {
    setSchedule(value)
    if (!connection.enabled) {
      return
    }
    void run(async () => {
      const response = await runtime.request({
        type: 'sync.schedule',
        scheduleMinutes: Number(value)
      })
      if (response.kind !== 'sync-schedule') {
        throw new TypeError('Unexpected sync schedule response')
      }
      await onRefresh()
    })
  }

  const conflictKey = (entityType: string, entityId: string) =>
    `${entityType}\u0000${entityId}`

  const resolutionsFor = (
    bulkChoice?: 'local' | 'remote'
  ): SyncConflictResolution[] => {
    if (!conflict) {
      return []
    }
    return conflict.conflicts.map(item => {
      const selected = bulkChoice
        ? { choice: bulkChoice, custom: '' }
        : conflictChoices[conflictKey(item.entityType, item.entityId)]
      if (!selected) {
        throw new TypeError('Incomplete sync conflict resolution')
      }
      if (selected.choice !== 'custom') {
        return {
          entityType: item.entityType as SyncConflictResolution['entityType'],
          entityId: item.entityId,
          choice: selected.choice
        }
      }
      return {
        entityType: item.entityType as SyncConflictResolution['entityType'],
        entityId: item.entityId,
        choice: 'custom' as const,
        customValue: JSON.parse(selected.custom) as unknown
      }
    })
  }

  const resolveConflict = (bulkChoice?: 'local' | 'remote') =>
    void run(async () => {
      const response = await runtime.request({
        type: 'sync.resolve',
        at: new Date().toISOString(),
        resolutions: resolutionsFor(bulkChoice)
      })
      if (response.kind !== 'sync-resolution') {
        throw new TypeError('Unexpected sync resolution response')
      }
      setBulkReview(undefined)
      setFeedback(
        response.value.state === 'confirmed'
          ? {
              tone: 'success',
              title: copy.syncConflictResolvedTitle,
              body: copy.syncConflictResolvedBody
            }
          : {
              tone: 'degraded',
              title: copy.syncConflictTitle,
              body: copy.syncConflictBody
            }
      )
      await onRefresh()
    })

  const restoreRecovery = (snapshotId: string) =>
    void run(async () => {
      const response = await runtime.request({
        type: 'sync.recovery.restore',
        snapshotId,
        operationId: `sync-recovery:${crypto.randomUUID()}`,
        at: new Date().toISOString()
      })
      if (
        response.kind !== 'sync-recovery-restored' ||
        response.value.state !== 'restored'
      ) {
        throw new TypeError('Unable to restore sync recovery snapshot')
      }
      setRecoveryReview(undefined)
      setFeedback({
        tone: 'success',
        title: copy.syncRecoveryRestoredTitle,
        body: copy.syncRecoveryRestoredBody
      })
      await onRefresh()
    })

  const deleteRemote = () =>
    void run(async () => {
      if (!connection.remoteObjectId) {
        throw new TypeError('Remote sync object is unavailable')
      }
      const response = await runtime.request({
        type: 'sync.remote.delete',
        confirmedRemoteObjectId: remoteDeleteConfirmation,
        at: new Date().toISOString()
      })
      if (
        response.kind !== 'sync-remote-deleted' ||
        response.value.state !== 'deleted'
      ) {
        throw new TypeError('Unable to delete remote sync object')
      }
      setRemoteDeleteReview(false)
      setRemoteDeleteConfirmation('')
      setFeedback({
        tone: 'success',
        title: copy.syncRemoteDeletedTitle,
        body: copy.syncRemoteDeletedBody
      })
      await onRefresh()
    })

  return (
    <div className="settings-form" data-slot="sync-settings">
      <div className="settings-section-heading">
        <div>
          <h3>{copy.syncTitle}</h3>
          <p className="settings-muted">{copy.syncDescription}</p>
        </div>
        <Badge
          tone={
            connection.runtimeState === 'idle'
              ? 'success'
              : connection.runtimeState === 'degraded' ||
                  connection.runtimeState === 'conflict'
                ? 'degraded'
                : 'neutral'
          }
        >
          {copy.syncStateLabel(connection.runtimeState)}
        </Badge>
      </div>
      {feedback ? (
        <Notice
          body={feedback.body}
          title={feedback.title}
          tone={feedback.tone}
        />
      ) : null}
      <Notice
        body={copy.syncPlaintextBody}
        title={copy.syncPlaintextTitle}
        tone="degraded"
      />
      <div className="settings-sync-categories">
        <strong>{copy.syncCategoriesTitle}</strong>
        <span>{copy.syncCategoriesBody}</span>
      </div>
      {connection.enabled ? (
        <>
          <div className="settings-data-list">
            <span>{copy.syncProviderLabel}</span>
            <strong>{selectedProvider?.displayName ?? providerConfigId}</strong>
            <span>{copy.syncEndpointLabel}</span>
            <strong>{`${selectedProvider?.endpointOrigin ?? ''}${endpointPath}`}</strong>
            <span>{copy.syncRetentionLabel}</span>
            <strong>{retention}</strong>
            <span>{copy.syncRevocationLabel}</span>
            <strong>{revocation}</strong>
          </div>
          <SelectField
            disabled={pending}
            label={copy.syncScheduleLabel}
            onChange={event => changeSchedule(event.currentTarget.value)}
            options={[
              { value: '5', label: copy.syncScheduleFiveMinutes },
              { value: '15', label: copy.syncScheduleFifteenMinutes },
              { value: '60', label: copy.syncScheduleHourly }
            ]}
            value={schedule}
          />
          {disconnectReview ? (
            <div className="settings-review">
              <Notice
                body={copy.syncDisconnectReviewBody}
                title={copy.syncDisconnectReviewTitle}
                tone="degraded"
              />
              <div className="settings-actions">
                <Button
                  disabled={pending}
                  onClick={disconnect}
                  variant="danger"
                >
                  {copy.syncDisconnectConfirmAction}
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => setDisconnectReview(false)}
                  variant="quiet"
                >
                  {copy.removeProviderCancelAction}
                </Button>
              </div>
            </div>
          ) : conflict ? (
            <div className="settings-stack" data-slot="sync-conflict-review">
              <Notice
                body={copy.syncConflictBody}
                title={copy.syncConflictTitle}
                tone="degraded"
              />
              {conflict.conflicts.map(item => {
                const key = conflictKey(item.entityType, item.entityId)
                const selected = conflictChoices[key]
                return (
                  <div className="settings-review" key={key}>
                    <strong>{item.entityType}</strong>
                    <span className="settings-muted">{item.entityId}</span>
                    <SelectField
                      disabled={pending || bulkReview !== undefined}
                      label={copy.syncConflictChoiceLabel}
                      onChange={event => {
                        const choice = event.currentTarget.value
                        setConflictChoices(current => {
                          if (!choice) {
                            const next = { ...current }
                            delete next[key]
                            return next
                          }
                          return {
                            ...current,
                            [key]: {
                              choice: choice as 'local' | 'remote' | 'custom',
                              custom: current[key]?.custom ?? ''
                            }
                          }
                        })
                      }}
                      options={[
                        { value: '', label: copy.syncConflictChoiceLabel },
                        {
                          value: 'local',
                          label: copy.syncConflictLocalOption
                        },
                        {
                          value: 'remote',
                          label: copy.syncConflictRemoteOption
                        },
                        {
                          value: 'custom',
                          label: copy.syncConflictCustomOption
                        }
                      ]}
                      value={selected?.choice ?? ''}
                    />
                    {selected?.choice === 'custom' ? (
                      <Field
                        disabled={pending || bulkReview !== undefined}
                        label={copy.syncConflictCustomLabel}
                        onChange={event => {
                          const custom = event.currentTarget.value
                          setConflictChoices(current => ({
                            ...current,
                            [key]: {
                              choice: 'custom',
                              custom
                            }
                          }))
                        }}
                        value={selected.custom}
                      />
                    ) : null}
                  </div>
                )
              })}
              {bulkReview ? (
                <div className="settings-review">
                  <Notice
                    body={copy.syncConflictBulkReviewBody(
                      conflict.conflicts.length
                    )}
                    title={copy.syncConflictBulkReviewTitle}
                    tone="degraded"
                  />
                  <div className="settings-actions">
                    <Button
                      disabled={pending}
                      onClick={() => resolveConflict(bulkReview)}
                      variant="danger"
                    >
                      {copy.syncConflictBulkConfirmAction}
                    </Button>
                    <Button
                      disabled={pending}
                      onClick={() => setBulkReview(undefined)}
                      variant="quiet"
                    >
                      {copy.removeProviderCancelAction}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="settings-actions">
                    <Button
                      disabled={pending}
                      onClick={() => setBulkReview('local')}
                      variant="secondary"
                    >
                      {copy.syncConflictUseAllLocalAction}
                    </Button>
                    <Button
                      disabled={pending}
                      onClick={() => setBulkReview('remote')}
                      variant="secondary"
                    >
                      {copy.syncConflictUseAllRemoteAction}
                    </Button>
                  </div>
                  <Button
                    disabled={
                      pending ||
                      conflict.conflicts.some(
                        item =>
                          !conflictChoices[
                            conflictKey(item.entityType, item.entityId)
                          ]
                      )
                    }
                    onClick={() => resolveConflict()}
                    size="full"
                  >
                    {copy.syncConflictResolveAction}
                  </Button>
                </>
              )}
              <Button
                disabled={pending}
                onClick={() => setDisconnectReview(true)}
                variant="secondary"
              >
                {copy.syncDisconnectAction}
              </Button>
            </div>
          ) : remoteDeleteReview ? (
            <div className="settings-review">
              <Notice
                body={copy.syncRemoteDeleteReviewBody(
                  connection.remoteObjectId ?? ''
                )}
                title={copy.syncRemoteDeleteReviewTitle}
                tone="degraded"
              />
              <Field
                disabled={pending}
                label={copy.syncRemoteDeleteConfirmationLabel}
                onChange={event =>
                  setRemoteDeleteConfirmation(event.currentTarget.value)
                }
                value={remoteDeleteConfirmation}
              />
              <div className="settings-actions">
                <Button
                  disabled={
                    pending ||
                    remoteDeleteConfirmation !== connection.remoteObjectId
                  }
                  onClick={deleteRemote}
                  variant="danger"
                >
                  {copy.syncRemoteDeleteConfirmAction}
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => {
                    setRemoteDeleteReview(false)
                    setRemoteDeleteConfirmation('')
                  }}
                  variant="quiet"
                >
                  {copy.removeProviderCancelAction}
                </Button>
              </div>
            </div>
          ) : (
            <div className="settings-actions">
              <Button disabled={pending} onClick={syncNow}>
                {pending ? copy.pendingAction : copy.syncNowAction}
              </Button>
              <Button
                disabled={pending}
                onClick={() => setDisconnectReview(true)}
                variant="secondary"
              >
                {copy.syncDisconnectAction}
              </Button>
              <Button
                disabled={pending}
                onClick={() => setRemoteDeleteReview(true)}
                variant="secondary"
              >
                {copy.syncRemoteDeleteAction}
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <SelectField
            disabled={pending || eligibleProviders.length === 0}
            hint={copy.syncProviderHint}
            label={copy.syncProviderLabel}
            onChange={event => setProviderConfigId(event.currentTarget.value)}
            options={eligibleProviders.map(provider => ({
              value: provider.providerConfigId,
              label: provider.displayName
            }))}
            value={providerConfigId}
          />
          {selectedProvider && !selectedProvider.credentialRef ? (
            <Notice
              body={copy.syncCredentialRequiredBody}
              title={copy.syncCredentialRequiredTitle}
              tone="degraded"
            />
          ) : null}
          <Field
            disabled={pending}
            hint={copy.syncEndpointHint}
            label={copy.syncEndpointLabel}
            onChange={event => setEndpointPath(event.currentTarget.value)}
            value={endpointPath}
          />
          <Field
            disabled={pending}
            label={copy.syncRemoteObjectLabel}
            onChange={event => setRemoteObjectId(event.currentTarget.value)}
            value={remoteObjectId}
          />
          <SelectField
            disabled={pending}
            label={copy.syncScheduleLabel}
            onChange={event => changeSchedule(event.currentTarget.value)}
            options={[
              { value: '5', label: copy.syncScheduleFiveMinutes },
              { value: '15', label: copy.syncScheduleFifteenMinutes },
              { value: '60', label: copy.syncScheduleHourly }
            ]}
            value={schedule}
          />
          <Field
            disabled={pending}
            label={copy.syncRetentionLabel}
            onChange={event => setRetention(event.currentTarget.value)}
            value={retention}
          />
          <Field
            disabled={pending}
            label={copy.syncRevocationLabel}
            onChange={event => setRevocation(event.currentTarget.value)}
            value={revocation}
          />
          <ToggleField
            checked={consented}
            description={copy.syncConsentDescription}
            disabled={pending}
            label={copy.syncConsentLabel}
            onChange={setConsented}
          />
          {recoveryReview ? null : (
            <Button
              disabled={pending || !readyToConnect}
              onClick={connect}
              size="full"
            >
              {pending ? copy.pendingAction : copy.syncConnectAction}
            </Button>
          )}
          {recoveries.length > 0 ? (
            <div className="settings-stack" data-slot="sync-recoveries">
              <div>
                <h3>{copy.syncRecoveryTitle}</h3>
                <p className="settings-muted">{copy.syncRecoveryDescription}</p>
              </div>
              {recoveryReview ? (
                <div className="settings-review">
                  <Notice
                    body={copy.syncRecoveryReviewBody}
                    title={copy.syncRecoveryReviewTitle}
                    tone="degraded"
                  />
                  <div className="settings-actions">
                    <Button
                      disabled={pending}
                      onClick={() => restoreRecovery(recoveryReview)}
                      variant="danger"
                    >
                      {copy.syncRecoveryConfirmAction}
                    </Button>
                    <Button
                      disabled={pending}
                      onClick={() => setRecoveryReview(undefined)}
                      variant="quiet"
                    >
                      {copy.removeProviderCancelAction}
                    </Button>
                  </div>
                </div>
              ) : (
                recoveries.map(recovery => (
                  <div className="settings-review" key={recovery.id}>
                    <strong>
                      {copy.syncRecoveryRevisionLabel(recovery.revision)}
                    </strong>
                    <span className="settings-muted">
                      {new Date(recovery.createdAt).toLocaleString()}
                    </span>
                    {recovery.diff ? (
                      <span className="settings-muted">
                        {copy.syncRecoveryDiffLabel(
                          recovery.diff.added,
                          recovery.diff.changed,
                          recovery.diff.removed
                        )}
                      </span>
                    ) : null}
                    <Button
                      disabled={pending}
                      onClick={() => setRecoveryReview(recovery.id)}
                      variant="secondary"
                    >
                      {copy.syncRecoveryRestoreAction}
                    </Button>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
