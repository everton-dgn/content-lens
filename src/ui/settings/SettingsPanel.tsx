// biome-ignore-all lint/performance/noJsxPropsBind: controlled form handlers need the current draft and item scope.
import {
  Activity,
  Bot,
  Palette,
  PanelsTopLeft,
  ShieldCheck,
  SlidersHorizontal
} from 'lucide-react'
import {
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import type { ModelDescriptor, ModelTask } from '@/ai/models/contracts'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import type { ProviderRemovalImpact } from '@/application/settings/provider-impact'
import type { SettingsRuntimeSnapshot } from '@/application/settings/runtime-contracts'
import type { Platform } from '@/core/content/contracts'
import type { ContentLensSettings } from '@/core/settings'
import {
  Button,
  Notice,
  SectionNav,
  type SectionNavVariant,
  StatePanel,
  Surface,
  ToggleField
} from '@/ui/components'
import { useTheme } from '@/ui/hooks/useTheme'
import {
  getPlatformLabel,
  getProviderConnectionTitle,
  getTaskLabel,
  type SettingsPanelCopy
} from '@/ui/settings/copy'
import { DiagnosticsSettings } from '@/ui/settings/DiagnosticsSettings'
import { GeneralSettings } from '@/ui/settings/GeneralSettings'
import { InterfaceSettings } from '@/ui/settings/InterfaceSettings'
import { ModelRoutingSettings } from '@/ui/settings/ModelRoutingSettings'
import { hasConsent, requiredCloudConsents } from '@/ui/settings/model'
import { PlatformSettings } from '@/ui/settings/PlatformSettings'
import { PrivacyDataSettings } from '@/ui/settings/PrivacyDataSettings'
import { ProviderSettings } from '@/ui/settings/ProviderSettings'
import { catalogRefreshKinds } from '@/ui/settings/provider-kinds'
import {
  browserSettingsRuntime,
  type SettingsRuntimeClient
} from '@/ui/settings/runtime'
import type { ColorMode } from '@/ui/styles/theme'

type SettingsSection =
  | 'general'
  | 'ai'
  | 'platforms'
  | 'privacy-data'
  | 'diagnostics'
  | 'interface'
type AiSection = 'providers' | 'models'
type Feedback =
  | { tone: 'success' | 'error' | 'degraded'; title: string; body: string }
  | undefined

export type SettingsPanelProps = {
  copy: SettingsPanelCopy
  onOpenData?(): void
  onOpenFeeds?(): void
  onProfileChanged(): undefined | Promise<unknown>
  navigationVariant?: Extract<SectionNavVariant, 'compact' | 'tabs'>
  runtime?: SettingsRuntimeClient
}

export const SettingsPanel = ({
  copy,
  onOpenData,
  onOpenFeeds,
  onProfileChanged,
  navigationVariant = 'tabs',
  runtime = browserSettingsRuntime
}: SettingsPanelProps) => {
  const { setTheme } = useTheme()
  const [section, setSection] = useState<SettingsSection>('general')
  const [aiSection, setAiSection] = useState<AiSection>('providers')
  const [pendingSection, setPendingSection] = useState<SettingsSection>()
  const [pendingAiSection, setPendingAiSection] = useState<AiSection>()
  const [snapshot, setSnapshot] = useState<SettingsRuntimeSnapshot>()
  const [draft, setDraft] = useState<ContentLensSettings>()
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>()
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('youtube')
  const [templateId, setTemplateId] = useState('openai')
  const [providerName, setProviderName] = useState('OpenAI')
  const [endpointOrigin, setEndpointOrigin] = useState('https://api.openai.com')
  const [credentialMode, setCredentialMode] = useState('session-only')
  const [credential, setCredential] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [externalReference, setExternalReference] = useState('')
  const [providerFormDirty, setProviderFormDirty] = useState(false)
  const [credentialFormDirty, setCredentialFormDirty] = useState(false)
  const [testModelId, setTestModelId] = useState('')
  const [quotaAcknowledged, setQuotaAcknowledged] = useState(false)
  const [editProviderName, setEditProviderName] = useState('')
  const [editEndpointOrigin, setEditEndpointOrigin] = useState('')
  const [disconnectReview, setDisconnectReview] = useState(false)
  const [removalImpact, setRemovalImpact] = useState<ProviderRemovalImpact>()
  const [modelProviderId, setModelProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [modelName, setModelName] = useState('')
  const [modelTasks, setModelTasks] = useState<ModelTask[]>([
    'classification-text'
  ])
  const [modelFormDirty, setModelFormDirty] = useState(false)
  const [cloudReviewed, setCloudReviewed] = useState(false)
  const sectionTriggerRef = useRef<HTMLElement>(null)
  const committedColorModeRef = useRef<ColorMode | undefined>(undefined)
  const savedColorModeRef = useRef<ColorMode | undefined>(undefined)
  const settingsPanelRef = useRef<HTMLElement>(null)
  const unsavedConfirmationRef = useRef<HTMLDivElement>(null)
  const removeCancelRef = useRef<HTMLButtonElement>(null)
  const removeTriggerRef = useRef<HTMLButtonElement>(null)
  const disconnectCancelRef = useRef<HTMLButtonElement>(null)
  const disconnectTriggerRef = useRef<HTMLButtonElement>(null)
  const updateDraft = (
    update: (current: ContentLensSettings) => ContentLensSettings
  ) => {
    setDraft(current => (current ? update(current) : current))
  }
  const draftColorMode = draft?.interface.colorMode
  const savedColorMode = snapshot?.settings.settings.interface.colorMode

  useEffect(() => {
    if (!draftColorMode) {
      return
    }
    setTheme(draftColorMode, { broadcast: false })
  }, [draftColorMode, setTheme])

  useEffect(() => {
    if (!savedColorMode) {
      return
    }
    savedColorModeRef.current = savedColorMode
    if (committedColorModeRef.current === undefined) {
      committedColorModeRef.current = savedColorMode
      return
    }
    if (committedColorModeRef.current !== savedColorMode) {
      committedColorModeRef.current = savedColorMode
      setTheme(savedColorMode)
    }
  }, [savedColorMode, setTheme])

  useEffect(() => {
    return () => {
      if (savedColorModeRef.current) {
        setTheme(savedColorModeRef.current, { broadcast: false })
      }
    }
  }, [setTheme])

  const load = useCallback(async () => {
    setPending(true)
    setFeedback(undefined)
    try {
      const response = await runtime.request({ type: 'settings.snapshot' })
      if (response.kind !== 'snapshot') {
        throw new Error(response.kind)
      }
      setSnapshot(response.value)
      setDraft(structuredClone(response.value.settings.settings))
      const firstProvider = response.value.providers.providers[0]
      if (firstProvider) {
        setSelectedProviderId(
          current => current || firstProvider.providerConfigId
        )
        setModelProviderId(current => current || firstProvider.providerConfigId)
      }
    } catch {
      setSnapshot(undefined)
      setDraft(undefined)
      setFeedback({
        tone: 'error',
        title: copy.errorTitle,
        body: copy.errorBody
      })
    } finally {
      setPending(false)
    }
  }, [copy.errorBody, copy.errorTitle, runtime])

  useEffect(() => {
    void load()
  }, [load])

  const settingsReady = Boolean(snapshot && draft)
  const scrollResetKey = [
    section,
    aiSection,
    pendingSection ?? 'none',
    pendingAiSection ?? 'none',
    settingsReady ? 'ready' : 'loading'
  ].join(':')

  useEffect(() => {
    if (navigationVariant !== 'compact' || !scrollResetKey) {
      return
    }
    const scrollContainer = settingsPanelRef.current?.closest(
      '.cl-shell--with-navigation .cl-shell__content'
    )
    scrollContainer?.scrollTo?.({ behavior: 'auto', left: 0, top: 0 })
  }, [navigationVariant, scrollResetKey])

  const selectedProvider = snapshot?.providers.providers.find(
    provider => provider.providerConfigId === selectedProviderId
  )

  useEffect(() => {
    if (selectedProvider) {
      setEditProviderName(selectedProvider.displayName)
      setEditEndpointOrigin(selectedProvider.endpointOrigin)
    }
  }, [selectedProvider])
  const modelProvider = snapshot?.providers.providers.find(
    provider => provider.providerConfigId === modelProviderId
  )
  const requiredConsents = useMemo(
    () =>
      draft && snapshot
        ? requiredCloudConsents(draft, snapshot, new Date().toISOString())
        : [],
    [draft, snapshot]
  )
  const isDirty = useMemo(
    () =>
      Boolean(
        draft &&
          snapshot &&
          JSON.stringify(draft) !== JSON.stringify(snapshot.settings.settings)
      ),
    [draft, snapshot]
  )
  const providerEditDirty = Boolean(
    selectedProvider &&
      selectedProvider.kind !== 'browser-built-in' &&
      (editProviderName !== selectedProvider.displayName ||
        editEndpointOrigin !== selectedProvider.endpointOrigin)
  )
  const transientDirty =
    section === 'ai' && aiSection === 'providers'
      ? providerFormDirty || credentialFormDirty || providerEditDirty
      : section === 'ai' && aiSection === 'models'
        ? modelFormDirty
        : false
  const hasUnsavedChanges = isDirty || transientDirty

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return
    }
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventUnload)
    return () => window.removeEventListener('beforeunload', preventUnload)
  }, [hasUnsavedChanges])

  useEffect(() => {
    if (pendingSection) {
      unsavedConfirmationRef.current
        ?.querySelector<HTMLButtonElement>('[data-settings-continue]')
        ?.focus()
    }
  }, [pendingSection])

  const refresh = async () => {
    const response = await runtime.request({ type: 'settings.snapshot' })
    if (response.kind !== 'snapshot') {
      throw new Error(response.kind)
    }
    setSnapshot(response.value)
    return response.value
  }

  const run = async (operation: () => Promise<void>) => {
    setPending(true)
    setFeedback(undefined)
    try {
      await operation()
    } catch {
      setFeedback({
        tone: 'error',
        title: copy.saveFailedTitle,
        body: copy.saveFailedBody
      })
    } finally {
      setPending(false)
    }
  }

  const selectTemplate = (value: string) => {
    setProviderFormDirty(true)
    setTemplateId(value)
    const template = snapshot?.templates.find(
      candidate => candidate.templateId === value
    )
    if (template) {
      setProviderName(template.displayName)
      setEndpointOrigin(template.suggestedEndpointOrigin ?? '')
      setCredentialMode(template.credentialModes[0] ?? 'none')
    }
  }

  const selectProvider = (providerConfigId: string) => {
    setSelectedProviderId(providerConfigId)
    setRemovalImpact(undefined)
    const provider = snapshot?.providers.providers.find(
      candidate => candidate.providerConfigId === providerConfigId
    )
    const template = snapshot?.templates.find(
      candidate => candidate.templateId === provider?.kind
    )
    setCredentialMode(template?.credentialModes[0] ?? 'none')
    setCredential('')
    setPassphrase('')
    setExternalReference('')
    setCredentialFormDirty(false)
  }

  const addProvider = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run(async () => {
      const response = await runtime.request({
        type: 'provider.create',
        templateId: templateId as ProviderDescriptor['kind'],
        displayName: providerName,
        ...(endpointOrigin ? { endpointOrigin } : {})
      })
      if (response.kind !== 'provider') {
        throw new Error(response.kind)
      }
      setSelectedProviderId(response.value.providerConfigId)
      setModelProviderId(response.value.providerConfigId)
      setProviderFormDirty(false)
      await refresh()
    })
  }

  const saveCredential = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedProvider) {
      return
    }
    void run(async () => {
      const response =
        credentialMode === 'session-only'
          ? await runtime.request({
              type: 'provider.credential',
              providerConfigId: selectedProvider.providerConfigId,
              mode: 'session-only',
              value: credential
            })
          : credentialMode === 'passphrase-wrapped'
            ? await runtime.request({
                type: 'provider.credential',
                providerConfigId: selectedProvider.providerConfigId,
                mode: 'passphrase-wrapped',
                value: credential,
                passphrase
              })
            : await runtime.request({
                type: 'provider.credential',
                providerConfigId: selectedProvider.providerConfigId,
                mode: 'external-vault',
                externalReference
              })
      if (response.kind !== 'provider') {
        throw new Error(response.kind)
      }
      setCredential('')
      setPassphrase('')
      setExternalReference('')
      setCredentialFormDirty(false)
      setFeedback({
        tone: 'success',
        title: copy.credentialSavedTitle,
        body: copy.credentialSavedBody
      })
      await refresh()
    })
  }

  const requestProviderPermission = () => {
    if (!selectedProvider) {
      return
    }
    void run(async () => {
      const granted = await runtime.requestProviderPermission(selectedProvider)
      setFeedback({
        tone: granted ? 'success' : 'degraded',
        title: granted ? copy.permissionGranted : copy.permissionDenied,
        body: copy.providerPermissionBody
      })
    })
  }

  const refreshSelectedCatalog = () => {
    if (!selectedProvider || !catalogRefreshKinds.has(selectedProvider.kind)) {
      return
    }
    void run(async () => {
      const granted = await runtime.requestProviderPermission(selectedProvider)
      if (!granted) {
        setFeedback({
          tone: 'degraded',
          title: copy.permissionDenied,
          body: copy.providerPermissionBody
        })
        return
      }
      const response = await runtime.request({
        type: 'provider.catalog.refresh',
        providerConfigId: selectedProvider.providerConfigId
      })
      if (response.kind !== 'provider-catalog') {
        throw new Error(response.kind)
      }
      await refresh()
      setFeedback({
        tone: 'success',
        title: copy.catalogRefreshedTitle,
        body: copy.catalogRefreshedBody(response.value.length)
      })
    })
  }

  const testConnection = () => {
    if (!selectedProvider || !testModelId || !quotaAcknowledged) {
      return
    }
    void run(async () => {
      const response = await runtime.request({
        type: 'provider.test',
        providerConfigId: selectedProvider.providerConfigId,
        modelId: testModelId,
        quotaAcknowledged: true
      })
      if (response.kind !== 'connection-test') {
        throw new Error(response.kind)
      }
      const ready = response.value.result.outcome === 'success'
      const code = response.value.result.code
      setFeedback({
        tone: ready ? 'success' : 'degraded',
        title: getProviderConnectionTitle(code),
        body: `${ready ? copy.connectionReadyBody : copy.connectionFailedBody} ${copy.connectionCodeLabel}: ${code}`
      })
      await refresh()
    })
  }

  const reviewProviderDisconnect = () => {
    setRemovalImpact(undefined)
    setDisconnectReview(true)
  }

  const closeProviderDisconnect = () => {
    setDisconnectReview(false)
    queueMicrotask(() => disconnectTriggerRef.current?.focus())
  }

  const confirmProviderDisconnect = () => {
    if (!selectedProvider) {
      return
    }
    void run(async () => {
      const response = await runtime.request({
        type: 'provider.disconnect',
        providerConfigId: selectedProvider.providerConfigId
      })
      if (response.kind !== 'provider') {
        throw new Error(response.kind)
      }
      setDisconnectReview(false)
      await refresh()
    })
  }

  const editProvider = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedProvider) {
      return
    }
    void run(async () => {
      const response = await runtime.request({
        type: 'provider.update',
        providerConfigId: selectedProvider.providerConfigId,
        displayName: editProviderName,
        endpointOrigin: editEndpointOrigin
      })
      if (response.kind !== 'provider') {
        throw new Error(response.kind)
      }
      await refresh()
      setFeedback({
        tone: 'success',
        title: copy.providerUpdatedTitle,
        body: copy.providerUpdatedBody
      })
    })
  }

  const reviewProviderRemoval = () => {
    if (!selectedProvider) {
      return
    }
    setDisconnectReview(false)
    void run(async () => {
      const response = await runtime.request({
        type: 'provider.remove.preview',
        providerConfigId: selectedProvider.providerConfigId
      })
      if (response.kind !== 'provider-removal-preview') {
        throw new Error(response.kind)
      }
      setRemovalImpact(response.value)
    })
  }

  const closeProviderRemoval = () => {
    setRemovalImpact(undefined)
    queueMicrotask(() => removeTriggerRef.current?.focus())
  }

  const reviewProviderRoutes = () => {
    setRemovalImpact(undefined)
    setAiSection('models')
  }

  const confirmProviderRemoval = () => {
    if (!selectedProvider || !removalImpact || removalImpact.blocked) {
      return
    }
    void run(async () => {
      const response = await runtime.request({
        type: 'provider.remove',
        providerConfigId: selectedProvider.providerConfigId
      })
      if (response.kind !== 'provider-removed') {
        if (response.kind === 'provider-removal-preview') {
          setRemovalImpact(response.value)
          return
        }
        throw new Error(response.kind)
      }
      const next = await refresh()
      setSelectedProviderId(next.providers.providers[0]?.providerConfigId ?? '')
      setModelProviderId(next.providers.providers[0]?.providerConfigId ?? '')
      setRemovalImpact(undefined)
      setFeedback({
        tone: 'success',
        title: copy.providerRemovedTitle,
        body: copy.providerRemovedBody
      })
    })
  }

  const toggleModelTask = (task: ModelTask, checked: boolean) => {
    setModelFormDirty(true)
    setModelTasks(current =>
      checked
        ? [...new Set([...current, task])]
        : current.filter(candidate => candidate !== task)
    )
  }

  const addModel = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!modelProvider) {
      return
    }
    void run(async () => {
      const checkedAt = new Date().toISOString()
      const model: ModelDescriptor = {
        providerConfigId: modelProvider.providerConfigId,
        modelId,
        displayName: modelName,
        declaredVersion: null,
        executionKind: modelProvider.execution,
        catalogSource: 'user',
        lastCheckedAt: checkedAt,
        status: 'available',
        capabilities: modelTasks.map(task => {
          const vision = task === 'classification-vision'
          return {
            task,
            modalities: vision ? ['text', 'image'] : ['text'],
            languages: ['en', 'pt', 'es'],
            imageMimeTypes: vision
              ? ['image/jpeg', 'image/png', 'image/webp']
              : [],
            maxInputBytes: 4_194_304,
            maxOutputBytes: 65_536,
            structuredOutput: true,
            evidence: 'declared',
            source: 'user',
            verifiedAt: null
          }
        })
      }
      const response = await runtime.request({ type: 'model.register', model })
      if (response.kind !== 'model') {
        throw new Error(response.kind)
      }
      setModelId('')
      setModelName('')
      setModelTasks(['classification-text'])
      setModelFormDirty(false)
      await refresh()
    })
  }

  const requestPlatformPermission = () => {
    if (!draft) {
      return
    }
    void run(async () => {
      const granted = await runtime.requestPlatformPermission(selectedPlatform)
      setDraft(current =>
        current
          ? {
              ...current,
              platforms: {
                ...current.platforms,
                [selectedPlatform]: {
                  ...current.platforms[selectedPlatform],
                  permissionState: granted ? 'granted' : 'denied'
                }
              }
            }
          : current
      )
      setFeedback({
        tone: granted ? 'success' : 'degraded',
        title: granted ? copy.permissionGranted : copy.permissionDenied,
        body: copy.permissionBody
      })
    })
  }

  const saveSettings = (
    nextSection?: SettingsSection,
    nextAiSection?: AiSection
  ) => {
    if (!draft || !snapshot) {
      return
    }
    void run(async () => {
      if (
        requiredConsents.some(
          ({ key }) => !hasConsent(snapshot.providers.consents, key)
        ) &&
        !cloudReviewed
      ) {
        setFeedback({
          tone: 'degraded',
          title: copy.cloudConsentTitle,
          body: copy.cloudConsentBody
        })
        return
      }
      for (const consent of requiredConsents) {
        if (!hasConsent(snapshot.providers.consents, consent.key)) {
          const response = await runtime.request({
            type: 'provider.consent',
            receipt: consent.receipt
          })
          if (response.kind !== 'consent') {
            throw new Error(response.kind)
          }
        }
      }
      const response = await runtime.request({
        type: 'settings.save',
        operationId: `operation:settings:${crypto.randomUUID()}`,
        expectedRevision: snapshot.settings.revision,
        at: new Date().toISOString(),
        settings: draft,
        reviewedConsentKeys: requiredConsents.map(({ key }) => key)
      })
      if (
        response.kind !== 'settings-save' ||
        response.value.state !== 'committed'
      ) {
        throw new Error('settings-save-failed')
      }
      const next = await refresh()
      setDraft(structuredClone(next.settings.settings))
      setCloudReviewed(false)
      setPendingSection(undefined)
      setPendingAiSection(undefined)
      if (nextSection) {
        setSection(nextSection)
      }
      if (nextAiSection) {
        setAiSection(nextAiSection)
      }
      setFeedback({
        tone: 'success',
        title: copy.savedTitle,
        body: copy.savedBody
      })
      await onProfileChanged()
    })
  }

  const saveTransientChanges = () => {
    if (!snapshot || !pendingSection) {
      return
    }
    const nextSection = pendingSection
    const nextAiSection = pendingAiSection
    void run(async () => {
      if (section === 'ai' && aiSection === 'providers') {
        if (providerEditDirty && selectedProvider) {
          const response = await runtime.request({
            type: 'provider.update',
            providerConfigId: selectedProvider.providerConfigId,
            displayName: editProviderName,
            endpointOrigin: editEndpointOrigin
          })
          if (response.kind !== 'provider') {
            throw new Error(response.kind)
          }
        }
        if (credentialFormDirty && selectedProvider) {
          const response =
            credentialMode === 'session-only'
              ? await runtime.request({
                  type: 'provider.credential',
                  providerConfigId: selectedProvider.providerConfigId,
                  mode: 'session-only',
                  value: credential
                })
              : credentialMode === 'passphrase-wrapped'
                ? await runtime.request({
                    type: 'provider.credential',
                    providerConfigId: selectedProvider.providerConfigId,
                    mode: 'passphrase-wrapped',
                    value: credential,
                    passphrase
                  })
                : await runtime.request({
                    type: 'provider.credential',
                    providerConfigId: selectedProvider.providerConfigId,
                    mode: 'external-vault',
                    externalReference
                  })
          if (response.kind !== 'provider') {
            throw new Error(response.kind)
          }
        }
        if (providerFormDirty) {
          const response = await runtime.request({
            type: 'provider.create',
            templateId: templateId as ProviderDescriptor['kind'],
            displayName: providerName,
            ...(endpointOrigin ? { endpointOrigin } : {})
          })
          if (response.kind !== 'provider') {
            throw new Error(response.kind)
          }
          setSelectedProviderId(response.value.providerConfigId)
          setModelProviderId(response.value.providerConfigId)
        }
      } else if (
        section === 'ai' &&
        aiSection === 'models' &&
        modelFormDirty &&
        modelProvider
      ) {
        const checkedAt = new Date().toISOString()
        const response = await runtime.request({
          type: 'model.register',
          model: {
            providerConfigId: modelProvider.providerConfigId,
            modelId,
            displayName: modelName,
            declaredVersion: null,
            executionKind: modelProvider.execution,
            catalogSource: 'user',
            lastCheckedAt: checkedAt,
            status: 'available',
            capabilities: modelTasks.map(task => {
              const vision = task === 'classification-vision'
              return {
                task,
                modalities: vision ? ['text', 'image'] : ['text'],
                languages: ['en', 'pt', 'es'],
                imageMimeTypes: vision
                  ? ['image/jpeg', 'image/png', 'image/webp']
                  : [],
                maxInputBytes: 4_194_304,
                maxOutputBytes: 65_536,
                structuredOutput: true,
                evidence: 'declared',
                source: 'user',
                verifiedAt: null
              }
            })
          }
        })
        if (response.kind !== 'model') {
          throw new Error(response.kind)
        }
      }
      await refresh()
      setProviderFormDirty(false)
      setCredentialFormDirty(false)
      setModelFormDirty(false)
      setCredential('')
      setPassphrase('')
      setExternalReference('')
      setModelId('')
      setModelName('')
      setModelTasks(['classification-text'])
      setPendingSection(undefined)
      setPendingAiSection(undefined)
      setSection(nextSection)
      if (nextAiSection) {
        setAiSection(nextAiSection)
      }
      setFeedback({
        tone: 'success',
        title: copy.savedTitle,
        body: copy.savedBody
      })
    })
  }

  const savePendingChanges = () => {
    if (isDirty) {
      saveSettings(
        transientDirty ? undefined : pendingSection,
        transientDirty ? undefined : pendingAiSection
      )
      return
    }
    saveTransientChanges()
  }

  const requestSection = (target: SettingsSection) => {
    if (target === section) {
      return
    }
    if (hasUnsavedChanges) {
      sectionTriggerRef.current = document.activeElement as HTMLElement | null
      setPendingAiSection(undefined)
      setPendingSection(target)
      return
    }
    setSection(target)
  }

  const requestAiSection = (target: AiSection) => {
    if (section === 'ai' && target === aiSection) {
      return
    }
    if (hasUnsavedChanges) {
      sectionTriggerRef.current = document.activeElement as HTMLElement | null
      setPendingAiSection(target)
      setPendingSection('ai')
      return
    }
    setAiSection(target)
    setSection('ai')
  }

  const continueEditing = () => {
    setPendingSection(undefined)
    setPendingAiSection(undefined)
    queueMicrotask(() => sectionTriggerRef.current?.focus())
  }

  const discardAndContinue = () => {
    if (!snapshot || !pendingSection) {
      return
    }
    setDraft(structuredClone(snapshot.settings.settings))
    setCloudReviewed(false)
    setProviderFormDirty(false)
    setCredentialFormDirty(false)
    setModelFormDirty(false)
    setCredential('')
    setPassphrase('')
    setExternalReference('')
    setEditProviderName(selectedProvider?.displayName ?? '')
    setEditEndpointOrigin(selectedProvider?.endpointOrigin ?? '')
    setModelId('')
    setModelName('')
    setModelTasks(['classification-text'])
    setSection(pendingSection)
    if (pendingAiSection) {
      setAiSection(pendingAiSection)
    }
    setPendingSection(undefined)
    setPendingAiSection(undefined)
  }

  if (!snapshot || !draft) {
    return feedback?.tone === 'error' ? (
      <StatePanel
        description={feedback.body}
        eyebrow={copy.title}
        primaryAction={<Button onClick={load}>{copy.retryAction}</Button>}
        state="error"
        title={feedback.title}
      />
    ) : (
      <StatePanel
        description={copy.loadingBody}
        eyebrow={copy.title}
        state="loading"
        title={copy.loadingTitle}
      />
    )
  }

  let content: ReactNode
  if (section === 'general') {
    content = (
      <GeneralSettings
        copy={copy}
        draft={draft}
        onOpenData={onOpenData}
        onOpenFeeds={onOpenFeeds}
        presentation={navigationVariant === 'compact' ? 'sidepanel' : 'default'}
        snapshot={snapshot}
      />
    )
  } else if (section === 'ai' && aiSection === 'providers') {
    content = (
      <ProviderSettings
        addProvider={addProvider}
        closeProviderDisconnect={closeProviderDisconnect}
        closeProviderRemoval={closeProviderRemoval}
        confirmProviderDisconnect={confirmProviderDisconnect}
        confirmProviderRemoval={confirmProviderRemoval}
        copy={copy}
        credential={credential}
        credentialMode={credentialMode}
        disconnectCancelRef={disconnectCancelRef}
        disconnectReview={disconnectReview}
        disconnectTriggerRef={disconnectTriggerRef}
        draft={draft}
        editEndpointOrigin={editEndpointOrigin}
        editProvider={editProvider}
        editProviderName={editProviderName}
        endpointOrigin={endpointOrigin}
        externalReference={externalReference}
        passphrase={passphrase}
        pending={pending}
        providerName={providerName}
        quotaAcknowledged={quotaAcknowledged}
        refreshSelectedCatalog={refreshSelectedCatalog}
        removalImpact={removalImpact}
        removeCancelRef={removeCancelRef}
        removeTriggerRef={removeTriggerRef}
        requestProviderPermission={requestProviderPermission}
        reviewProviderDisconnect={reviewProviderDisconnect}
        reviewProviderRemoval={reviewProviderRemoval}
        reviewProviderRoutes={reviewProviderRoutes}
        saveCredential={saveCredential}
        selectProvider={selectProvider}
        selectTemplate={selectTemplate}
        selectedProviderId={selectedProviderId}
        setCredential={setCredential}
        setCredentialFormDirty={setCredentialFormDirty}
        setCredentialMode={setCredentialMode}
        setEditEndpointOrigin={setEditEndpointOrigin}
        setEditProviderName={setEditProviderName}
        setEndpointOrigin={setEndpointOrigin}
        setExternalReference={setExternalReference}
        setPassphrase={setPassphrase}
        setProviderFormDirty={setProviderFormDirty}
        setProviderName={setProviderName}
        setQuotaAcknowledged={setQuotaAcknowledged}
        setTestModelId={setTestModelId}
        snapshot={snapshot}
        templateId={templateId}
        testConnection={testConnection}
        testModelId={testModelId}
      />
    )
  } else if (section === 'ai' && aiSection === 'models') {
    content = (
      <ModelRoutingSettings
        advancedMode={draft.interface.advancedMode}
        copy={copy}
        draft={draft}
        modelId={modelId}
        modelName={modelName}
        modelProviderId={modelProviderId}
        modelTasks={modelTasks}
        onAddModel={addModel}
        onToggleTask={toggleModelTask}
        pending={pending}
        setDraft={setDraft}
        setModelFormDirty={setModelFormDirty}
        setModelId={setModelId}
        setModelName={setModelName}
        setModelProviderId={setModelProviderId}
        snapshot={snapshot}
        updateDraft={updateDraft}
      />
    )
  } else if (section === 'platforms') {
    content = (
      <PlatformSettings
        advancedMode={draft.interface.advancedMode}
        copy={copy}
        draft={draft}
        onRequestPermission={requestPlatformPermission}
        pending={pending}
        selectedPlatform={selectedPlatform}
        setSelectedPlatform={setSelectedPlatform}
        snapshot={snapshot}
        updateDraft={updateDraft}
      />
    )
  } else if (section === 'privacy-data') {
    content = (
      <PrivacyDataSettings
        copy={copy}
        onOpenData={onOpenData}
        onRefresh={load}
        runtime={runtime}
        snapshot={snapshot}
      />
    )
  } else if (section === 'diagnostics') {
    content = <DiagnosticsSettings copy={copy} onOpenData={onOpenData} />
  } else {
    content = (
      <InterfaceSettings copy={copy} draft={draft} updateDraft={updateDraft} />
    )
  }

  return (
    <section
      className="settings-panel"
      data-presentation={
        navigationVariant === 'compact' ? 'sidepanel' : 'default'
      }
      ref={settingsPanelRef}
    >
      <header className="settings-heading">
        <p>{copy.eyebrow}</p>
        <h2>{copy.title}</h2>
        <span>{copy.description}</span>
      </header>
      <SectionNav
        ariaLabel={copy.title}
        items={[
          {
            value: 'general',
            label: copy.tabGeneral,
            icon:
              navigationVariant === 'compact' ? SlidersHorizontal : undefined
          },
          {
            value: 'ai',
            label: copy.tabAiProviders,
            icon: navigationVariant === 'compact' ? Bot : undefined
          },
          {
            value: 'platforms',
            label: copy.tabPlatforms,
            icon: navigationVariant === 'compact' ? PanelsTopLeft : undefined
          },
          {
            value: 'privacy-data',
            label: copy.tabPrivacyData,
            icon: navigationVariant === 'compact' ? ShieldCheck : undefined
          },
          {
            value: 'diagnostics',
            label: copy.tabDiagnostics,
            icon: navigationVariant === 'compact' ? Activity : undefined
          },
          {
            value: 'interface',
            label: copy.tabInterface,
            icon: navigationVariant === 'compact' ? Palette : undefined
          }
        ]}
        onChange={requestSection}
        value={section}
        variant={navigationVariant}
      />
      {section === 'ai' ? (
        <SectionNav
          ariaLabel={copy.aiNavigationLabel}
          items={[
            { value: 'providers', label: copy.tabProviders },
            { value: 'models', label: copy.tabModels }
          ]}
          onChange={requestAiSection}
          value={aiSection}
          variant={navigationVariant}
        />
      ) : null}
      {pendingSection ? (
        <Surface>
          <div className="settings-form" ref={unsavedConfirmationRef}>
            <h3>{copy.unsavedTitle}</h3>
            <p className="settings-muted">{copy.unsavedBody}</p>
            <div className="settings-actions">
              <Button disabled={pending} onClick={savePendingChanges}>
                {copy.unsavedSaveAction}
              </Button>
              <Button
                disabled={pending}
                onClick={discardAndContinue}
                variant="danger"
              >
                {copy.unsavedDiscardAction}
              </Button>
              <Button
                data-settings-continue
                disabled={pending}
                onClick={continueEditing}
                variant="quiet"
              >
                {copy.unsavedContinueAction}
              </Button>
            </div>
          </div>
        </Surface>
      ) : null}
      {feedback ? (
        <Notice
          body={feedback.body}
          title={feedback.title}
          tone={feedback.tone}
        />
      ) : null}
      {content}
      {requiredConsents.length > 0 ? (
        <Surface tone="subtle">
          <div className="settings-form">
            <h3>{copy.cloudConsentTitle}</h3>
            <p className="settings-muted">{copy.cloudConsentBody}</p>
            <ul className="settings-consent-list">
              {requiredConsents.map(({ key, provider }) => (
                <li key={JSON.stringify(key)}>
                  <strong>{provider.displayName}</strong>
                  <span>
                    {getPlatformLabel(key.platform)} · {getTaskLabel(key.task)}{' '}
                    · {key.categories.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
            <ToggleField
              checked={cloudReviewed}
              label={copy.cloudConsentLabel}
              onChange={setCloudReviewed}
            />
          </div>
        </Surface>
      ) : null}
      {pendingSection ||
      removalImpact ||
      disconnectReview ||
      !isDirty ? null : (
        <Button disabled={pending} onClick={() => saveSettings()} size="full">
          {pending ? copy.pendingAction : copy.saveAction}
        </Button>
      )}
    </section>
  )
}
