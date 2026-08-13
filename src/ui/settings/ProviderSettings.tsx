// biome-ignore-all lint/performance/noJsxPropsBind: controlled provider fields need the current form scope.
import type { RefObject, SyntheticEvent } from 'react'

import type { ProviderDescriptor } from '@/ai/providers/contracts'
import type { ProviderRemovalImpact } from '@/application/settings/provider-impact'
import type { SettingsRuntimeSnapshot } from '@/application/settings/runtime-contracts'
import type { ContentLensSettings } from '@/core/settings'
import {
  Badge,
  Button,
  DataList,
  Dialog,
  Field,
  Notice,
  SecretField,
  SelectField,
  Surface,
  ToggleField
} from '@/ui/components'
import {
  getPlatformLabel,
  getProviderExecutionLabel,
  getProviderStatusLabel,
  getTaskLabel,
  type SettingsPanelCopy
} from '@/ui/settings/copy'
import { catalogRefreshKinds } from '@/ui/settings/provider-kinds'

const statusTone = (status: ProviderDescriptor['status']) =>
  status === 'ready'
    ? ('success' as const)
    : status === 'degraded' || status === 'rate-limited'
      ? ('degraded' as const)
      : ('neutral' as const)

export type ProviderSettingsProps = {
  addProvider: (event: SyntheticEvent<HTMLFormElement>) => void
  closeProviderDisconnect: () => void
  closeProviderRemoval: () => void
  confirmProviderDisconnect: () => void
  confirmProviderRemoval: () => void
  copy: SettingsPanelCopy
  credential: string
  credentialMode: string
  disconnectCancelRef: RefObject<HTMLButtonElement | null>
  disconnectReview: boolean
  disconnectTriggerRef: RefObject<HTMLButtonElement | null>
  draft: ContentLensSettings
  editEndpointOrigin: string
  editProvider: (event: SyntheticEvent<HTMLFormElement>) => void
  editProviderName: string
  endpointOrigin: string
  externalReference: string
  passphrase: string
  pending: boolean
  providerName: string
  quotaAcknowledged: boolean
  refreshSelectedCatalog: () => void
  removalImpact: ProviderRemovalImpact | undefined
  removeCancelRef: RefObject<HTMLButtonElement | null>
  removeTriggerRef: RefObject<HTMLButtonElement | null>
  requestProviderPermission: () => void
  reviewProviderDisconnect: () => void
  reviewProviderRemoval: () => void
  reviewProviderRoutes: () => void
  saveCredential: (event: SyntheticEvent<HTMLFormElement>) => void
  selectProvider: (providerConfigId: string) => void
  selectTemplate: (value: string) => void
  selectedProviderId: string
  setCredential: (value: string) => void
  setCredentialFormDirty: (dirty: boolean) => void
  setCredentialMode: (value: string) => void
  setEditEndpointOrigin: (value: string) => void
  setEditProviderName: (value: string) => void
  setEndpointOrigin: (value: string) => void
  setExternalReference: (value: string) => void
  setPassphrase: (value: string) => void
  setProviderFormDirty: (dirty: boolean) => void
  setProviderName: (value: string) => void
  setQuotaAcknowledged: (acknowledged: boolean) => void
  setTestModelId: (value: string) => void
  snapshot: SettingsRuntimeSnapshot
  templateId: string
  testConnection: () => void
  testModelId: string
}

export const ProviderSettings = ({
  addProvider,
  closeProviderDisconnect,
  closeProviderRemoval,
  confirmProviderDisconnect,
  confirmProviderRemoval,
  copy,
  credential,
  credentialMode,
  disconnectCancelRef,
  disconnectReview,
  disconnectTriggerRef,
  draft,
  editEndpointOrigin,
  editProvider,
  editProviderName,
  endpointOrigin,
  externalReference,
  passphrase,
  pending,
  providerName,
  quotaAcknowledged,
  refreshSelectedCatalog,
  removalImpact,
  removeCancelRef,
  removeTriggerRef,
  requestProviderPermission,
  reviewProviderDisconnect,
  reviewProviderRemoval,
  reviewProviderRoutes,
  saveCredential,
  selectProvider,
  selectTemplate,
  selectedProviderId,
  setCredential,
  setCredentialFormDirty,
  setCredentialMode,
  setEditEndpointOrigin,
  setEditProviderName,
  setEndpointOrigin,
  setExternalReference,
  setPassphrase,
  setProviderFormDirty,
  setProviderName,
  setQuotaAcknowledged,
  setTestModelId,
  snapshot,
  templateId,
  testConnection,
  testModelId
}: ProviderSettingsProps) => {
  const selectedProvider = snapshot.providers.providers.find(
    provider => provider.providerConfigId === selectedProviderId
  )
  const selectedTemplate = snapshot.templates.find(
    template => template.templateId === templateId
  )
  const selectedProviderTemplate = snapshot.templates.find(
    template => template.templateId === selectedProvider?.kind
  )
  const templateOptions = snapshot.templates
    .filter(({ templateId: id }) => id !== 'browser-built-in')
    .map(template => ({
      value: template.templateId,
      label: template.displayName
    }))
  const providerOptions = snapshot.providers.providers.map(provider => ({
    value: provider.providerConfigId,
    label: provider.displayName
  }))
  const credentialOptions = (
    selectedProviderTemplate?.credentialModes ?? ['none']
  ).map(mode => ({
    value: mode,
    label:
      mode === 'none'
        ? copy.credentialNone
        : mode === 'session-only'
          ? copy.credentialSession
          : mode === 'passphrase-wrapped'
            ? copy.credentialWrapped
            : copy.credentialExternal
  }))
  const selectedProviderModels = selectedProvider
    ? snapshot.providers.models.filter(
        model => model.providerConfigId === selectedProvider.providerConfigId
      )
    : []
  const selectedCredentialLabel =
    selectedProvider?.credentialMode === 'none'
      ? copy.credentialNone
      : selectedProvider?.credentialMode === 'session-only'
        ? copy.credentialSession
        : selectedProvider?.credentialMode === 'passphrase-wrapped'
          ? copy.credentialWrapped
          : copy.credentialExternal
  return (
    <div className="settings-stack">
      <Surface>
        <form className="settings-form" onSubmit={addProvider}>
          <h3>{copy.addProviderAction}</h3>
          <SelectField
            label={copy.providerTemplateLabel}
            onChange={event => selectTemplate(event.currentTarget.value)}
            options={templateOptions}
            value={templateId}
          />
          <Field
            label={copy.providerDisplayLabel}
            onChange={event => {
              setProviderFormDirty(true)
              setProviderName(event.currentTarget.value)
            }}
            required
            value={providerName}
          />
          <Field
            hint={copy.endpointHint}
            label={copy.endpointLabel}
            onChange={event => {
              setProviderFormDirty(true)
              setEndpointOrigin(event.currentTarget.value)
            }}
            required={selectedTemplate?.suggestedEndpointOrigin === null}
            type="url"
            value={endpointOrigin}
          />
          <Button disabled={pending} type="submit" variant="secondary">
            {copy.addProviderAction}
          </Button>
        </form>
      </Surface>
      <Surface>
        <div className="settings-form">
          <h3>{copy.providersTitle}</h3>
          {providerOptions.length === 0 ? (
            <p className="settings-muted">{copy.providerEmpty}</p>
          ) : (
            <SelectField
              label={copy.providerSelectLabel}
              onChange={event => selectProvider(event.currentTarget.value)}
              options={providerOptions}
              value={selectedProviderId}
            />
          )}
          {selectedProvider ? (
            <>
              <DataList
                items={[
                  {
                    term: copy.providerStatusLabel,
                    description: (
                      <Badge tone={statusTone(selectedProvider.status)}>
                        {getProviderStatusLabel(selectedProvider.status)}
                      </Badge>
                    )
                  },
                  {
                    term: copy.providerTypeLabel,
                    description:
                      selectedProviderTemplate?.displayName ??
                      selectedProvider.kind
                  },
                  {
                    term: copy.executionLabel,
                    description: getProviderExecutionLabel(
                      selectedProvider.execution
                    )
                  },
                  {
                    term: copy.credentialModeLabel,
                    description: selectedCredentialLabel
                  },
                  {
                    term: copy.providerModelsLabel,
                    description: copy.providerModelCount(
                      selectedProviderModels.length
                    )
                  },
                  {
                    term: copy.providerLastVerificationLabel,
                    description:
                      selectedProvider.lastConnectionTest?.checkedAt ??
                      copy.modelVersionUnknown
                  },
                  ...(draft.interface.advancedMode
                    ? [
                        {
                          term: copy.endpointLabel,
                          description: (
                            <code>{selectedProvider.endpointOrigin}</code>
                          )
                        }
                      ]
                    : [])
                ]}
              />
              {selectedProvider.kind !== 'browser-built-in' ? (
                <>
                  <form className="settings-form" onSubmit={editProvider}>
                    <Field
                      label={copy.providerDisplayLabel}
                      onChange={event =>
                        setEditProviderName(event.currentTarget.value)
                      }
                      required
                      value={editProviderName}
                    />
                    <Field
                      hint={copy.endpointHint}
                      label={copy.endpointLabel}
                      onChange={event =>
                        setEditEndpointOrigin(event.currentTarget.value)
                      }
                      required
                      type="url"
                      value={editEndpointOrigin}
                    />
                    <Button
                      disabled={
                        pending ||
                        (editProviderName === selectedProvider.displayName &&
                          editEndpointOrigin ===
                            selectedProvider.endpointOrigin)
                      }
                      type="submit"
                      variant="secondary"
                    >
                      {copy.editProviderAction}
                    </Button>
                  </form>
                  <form className="settings-form" onSubmit={saveCredential}>
                    <SelectField
                      label={copy.credentialModeLabel}
                      onChange={event => {
                        setCredentialFormDirty(true)
                        setCredentialMode(event.currentTarget.value)
                      }}
                      options={credentialOptions}
                      value={credentialMode}
                    />
                    {credentialMode === 'external-vault' ? (
                      <Field
                        label={copy.credentialExternalReference}
                        onChange={event => {
                          setCredentialFormDirty(true)
                          setExternalReference(event.currentTarget.value)
                        }}
                        required
                        value={externalReference}
                      />
                    ) : credentialMode !== 'none' ? (
                      <SecretField
                        hideLabel={copy.hideSecretAction}
                        hint={copy.credentialSecretHint}
                        label={copy.credentialSecretLabel}
                        onChange={value => {
                          setCredentialFormDirty(true)
                          setCredential(value)
                        }}
                        revealLabel={copy.revealSecretAction}
                        value={credential}
                      />
                    ) : null}
                    {credentialMode === 'passphrase-wrapped' ? (
                      <SecretField
                        hideLabel={copy.hideSecretAction}
                        label={copy.credentialPassphrase}
                        onChange={value => {
                          setCredentialFormDirty(true)
                          setPassphrase(value)
                        }}
                        revealLabel={copy.revealSecretAction}
                        value={passphrase}
                      />
                    ) : null}
                    {credentialMode !== 'none' ? (
                      <Button
                        disabled={pending}
                        type="submit"
                        variant="secondary"
                      >
                        {copy.saveCredentialAction}
                      </Button>
                    ) : null}
                  </form>
                  <Notice
                    body={copy.providerPermissionBody}
                    title={copy.providerPermissionAction}
                    tone="info"
                  />
                  <Button
                    disabled={pending}
                    onClick={requestProviderPermission}
                    variant="secondary"
                  >
                    {copy.providerPermissionAction}
                  </Button>
                  {catalogRefreshKinds.has(selectedProvider.kind) ? (
                    <Button
                      disabled={
                        pending ||
                        (selectedProvider.kind !== 'ollama' &&
                          !selectedProvider.credentialRef)
                      }
                      onClick={refreshSelectedCatalog}
                      variant="secondary"
                    >
                      {copy.catalogRefreshAction}
                    </Button>
                  ) : null}
                </>
              ) : null}
              <Field
                hint={copy.testConnectionHint}
                label={copy.modelIdLabel}
                onChange={event => setTestModelId(event.currentTarget.value)}
                value={testModelId}
              />
              <ToggleField
                checked={quotaAcknowledged}
                label={copy.quotaAcknowledgement}
                onChange={setQuotaAcknowledged}
              />
              <div className="settings-actions">
                <Button
                  disabled={pending || !testModelId || !quotaAcknowledged}
                  onClick={testConnection}
                  variant="secondary"
                >
                  {copy.testConnectionAction}
                </Button>
                {selectedProvider.kind !== 'browser-built-in' &&
                !removalImpact ? (
                  <>
                    <Button
                      disabled={pending}
                      onClick={reviewProviderDisconnect}
                      ref={disconnectTriggerRef}
                      variant="danger"
                    >
                      {copy.disconnectAction}
                    </Button>
                    <Button
                      disabled={pending}
                      onClick={reviewProviderRemoval}
                      ref={removeTriggerRef}
                      variant="secondary"
                    >
                      {copy.removeProviderReviewAction}
                    </Button>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </Surface>
      {removalImpact ? (
        <Dialog
          cancelRef={removeCancelRef}
          description={
            removalImpact.blocked
              ? copy.removeProviderBlockedBody
              : copy.removeProviderReviewBody
          }
          onDismiss={closeProviderRemoval}
          title={
            removalImpact.blocked
              ? copy.removeProviderBlockedTitle
              : copy.removeProviderReviewTitle
          }
        >
          {removalImpact.models.length > 0 ? (
            <div className="settings-form">
              <strong>{copy.removeProviderModelsLabel}</strong>
              <ul className="settings-consent-list">
                {removalImpact.models.map(modelId => (
                  <li key={modelId}>
                    <code>{modelId}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {removalImpact.routes.length > 0 ? (
            <div className="settings-form">
              <strong>{copy.removeProviderRoutesLabel}</strong>
              <ul className="settings-consent-list">
                {removalImpact.routes.map(route => (
                  <li
                    key={`${route.platform ?? 'global'}:${route.task}:${route.role}:${route.modelId}`}
                  >
                    <span>
                      {route.platform
                        ? getPlatformLabel(route.platform)
                        : copy.globalRoutesTitle}
                      {' · '}
                      {getTaskLabel(route.task)}
                      {' · '}
                      {route.role === 'primary'
                        ? copy.removeProviderPrimaryRole
                        : copy.removeProviderFallbackRole}
                    </span>
                    <code>{route.modelId}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="settings-actions">
            {removalImpact.blocked ? (
              <Button onClick={reviewProviderRoutes}>
                {copy.removeProviderReviewRoutesAction}
              </Button>
            ) : (
              <Button onClick={confirmProviderRemoval} variant="danger">
                {copy.removeProviderConfirmAction}
              </Button>
            )}
            <Button
              onClick={closeProviderRemoval}
              ref={removeCancelRef}
              variant="quiet"
            >
              {copy.removeProviderCancelAction}
            </Button>
          </div>
        </Dialog>
      ) : null}
      {disconnectReview ? (
        <Dialog
          cancelRef={disconnectCancelRef}
          description={copy.disconnectReviewBody}
          onDismiss={closeProviderDisconnect}
          title={copy.disconnectReviewTitle}
        >
          <div className="settings-actions">
            <Button
              disabled={pending}
              onClick={confirmProviderDisconnect}
              variant="danger"
            >
              {copy.disconnectConfirmAction}
            </Button>
            <Button
              onClick={closeProviderDisconnect}
              ref={disconnectCancelRef}
              variant="quiet"
            >
              {copy.removeProviderCancelAction}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}
