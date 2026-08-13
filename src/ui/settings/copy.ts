import type { ModelTask } from '@/ai/models/contracts'
import type {
  ProviderConnectionCode,
  ProviderDescriptor
} from '@/ai/providers/contracts'
import type { Platform } from '@/core/content/contracts'
import type { PlatformSurface } from '@/core/content/surfaces'
import type { PlatformSettings } from '@/core/settings'
import { t } from '@/i18n/runtime'

export const getSettingsPanelCopy = () => ({
  addModelAction: t('settingsAddModelAction'),
  addProviderAction: t('settingsAddProviderAction'),
  advancedDescription: t('settingsAdvancedDescription'),
  advancedLabel: t('settingsAdvancedLabel'),
  advancedRoutingSummary: t('settingsAdvancedRoutingSummary'),
  allowCloudFallbackDescription: t('settingsAllowCloudFallbackDescription'),
  allowCloudFallbackLabel: t('settingsAllowCloudFallbackLabel'),
  allowHigherCostFallbackDescription: t(
    'settingsAllowHigherCostFallbackDescription'
  ),
  allowHigherCostFallbackLabel: t('settingsAllowHigherCostFallbackLabel'),
  cloudConsentBody: t('settingsCloudConsentBody'),
  cloudConsentLabel: t('settingsCloudConsentLabel'),
  cloudConsentTitle: t('settingsCloudConsentTitle'),
  colorDark: t('settingsColorDark'),
  colorLabel: t('settingsColorLabel'),
  colorLight: t('settingsColorLight'),
  colorSystem: t('settingsColorSystem'),
  connectionCodeLabel: t('settingsConnectionCodeLabel'),
  connectionFailedBody: t('settingsConnectionFailedBody'),
  connectionReadyBody: t('settingsConnectionReadyBody'),
  credentialExternal: t('settingsCredentialExternal'),
  credentialExternalReference: t('settingsCredentialExternalReference'),
  credentialModeLabel: t('settingsCredentialModeLabel'),
  credentialNone: t('settingsCredentialNone'),
  credentialPassphrase: t('settingsCredentialPassphrase'),
  credentialSavedBody: t('settingsCredentialSavedBody'),
  credentialSavedTitle: t('settingsCredentialSavedTitle'),
  credentialSecretHint: t('settingsCredentialSecretHint'),
  credentialSecretLabel: t('settingsCredentialSecretLabel'),
  credentialSession: t('settingsCredentialSession'),
  credentialWrapped: t('settingsCredentialWrapped'),
  description: t('settingsDescription'),
  deterministicBaselineLabel: t('settingsDeterministicBaselineLabel'),
  disabledOption: t('settingsDisabledOption'),
  disconnectAction: t('settingsDisconnectAction'),
  disconnectReviewBody: t('settingsDisconnectReviewBody'),
  disconnectReviewTitle: t('settingsDisconnectReviewTitle'),
  disconnectConfirmAction: t('settingsDisconnectConfirmAction'),
  editProviderAction: t('settingsEditProviderAction'),
  endpointHint: t('settingsEndpointHint'),
  endpointLabel: t('settingsEndpointLabel'),
  eyebrow: t('settingsEyebrow'),
  errorBody: t('settingsErrorBody'),
  errorTitle: t('settingsErrorTitle'),
  executionLabel: t('settingsExecutionLabel'),
  fallbackOrderLabel: t('settingsFallbackOrderLabel'),
  fallbackPositionLabel: (position: number) =>
    t('settingsFallbackPositionLabel', String(position)),
  globalRoutesBody: t('settingsGlobalRoutesBody'),
  globalRoutesTitle: t('settingsGlobalRoutesTitle'),
  dataShortcutAction: t('settingsDataShortcutAction'),
  feedsShortcutAction: t('settingsFeedsShortcutAction'),
  shortcutsDescription: t('settingsShortcutsDescription'),
  shortcutsTitle: t('settingsShortcutsTitle'),
  syncCategoriesBody: t('settingsSyncCategoriesBody'),
  syncCategoriesTitle: t('settingsSyncCategoriesTitle'),
  syncCompletedBody: t('settingsSyncCompletedBody'),
  syncCompletedTitle: t('settingsSyncCompletedTitle'),
  syncConnectAction: t('settingsSyncConnectAction'),
  syncConnectedBody: t('settingsSyncConnectedBody'),
  syncConnectedTitle: t('settingsSyncConnectedTitle'),
  syncConsentDescription: t('settingsSyncConsentDescription'),
  syncConsentLabel: t('settingsSyncConsentLabel'),
  syncConflictBody: t('settingsSyncConflictBody'),
  syncConflictTitle: t('settingsSyncConflictTitle'),
  syncConflictChoiceLabel: t('settingsSyncConflictChoiceLabel'),
  syncConflictCustomLabel: t('settingsSyncConflictCustomLabel'),
  syncConflictLocalOption: t('settingsSyncConflictLocalOption'),
  syncConflictRemoteOption: t('settingsSyncConflictRemoteOption'),
  syncConflictCustomOption: t('settingsSyncConflictCustomOption'),
  syncConflictResolveAction: t('settingsSyncConflictResolveAction'),
  syncConflictResolvedTitle: t('settingsSyncConflictResolvedTitle'),
  syncConflictResolvedBody: t('settingsSyncConflictResolvedBody'),
  syncConflictUseAllLocalAction: t('settingsSyncConflictUseAllLocalAction'),
  syncConflictUseAllRemoteAction: t('settingsSyncConflictUseAllRemoteAction'),
  syncConflictBulkReviewTitle: t('settingsSyncConflictBulkReviewTitle'),
  syncConflictBulkReviewBody: (count: number) =>
    t('settingsSyncConflictBulkReviewBody', String(count)),
  syncConflictBulkConfirmAction: t('settingsSyncConflictBulkConfirmAction'),
  syncCredentialRequiredBody: t('settingsSyncCredentialRequiredBody'),
  syncCredentialRequiredTitle: t('settingsSyncCredentialRequiredTitle'),
  syncDescription: t('settingsSyncDescription'),
  syncDisconnectAction: t('settingsSyncDisconnectAction'),
  syncDisconnectConfirmAction: t('settingsSyncDisconnectConfirmAction'),
  syncDisconnectedBody: t('settingsSyncDisconnectedBody'),
  syncDisconnectedTitle: t('settingsSyncDisconnectedTitle'),
  syncDisconnectReviewBody: t('settingsSyncDisconnectReviewBody'),
  syncDisconnectReviewTitle: t('settingsSyncDisconnectReviewTitle'),
  syncEndpointHint: t('settingsSyncEndpointHint'),
  syncEndpointLabel: t('settingsSyncEndpointLabel'),
  syncFailureBody: t('settingsSyncFailureBody'),
  syncFailureTitle: t('settingsSyncFailureTitle'),
  syncNowAction: t('settingsSyncNowAction'),
  syncPermissionBody: t('settingsSyncPermissionBody'),
  syncPermissionTitle: t('settingsSyncPermissionTitle'),
  syncPlaintextBody: t('settingsSyncPlaintextBody'),
  syncPlaintextTitle: t('settingsSyncPlaintextTitle'),
  syncProviderHint: t('settingsSyncProviderHint'),
  syncProviderLabel: t('settingsSyncProviderLabel'),
  syncRemoteObjectLabel: t('settingsSyncRemoteObjectLabel'),
  syncRetentionDefault: t('settingsSyncRetentionDefault'),
  syncRetentionLabel: t('settingsSyncRetentionLabel'),
  syncRevocationDefault: t('settingsSyncRevocationDefault'),
  syncRevocationLabel: t('settingsSyncRevocationLabel'),
  syncScheduleFifteenMinutes: t('settingsSyncScheduleFifteenMinutes'),
  syncScheduleFiveMinutes: t('settingsSyncScheduleFiveMinutes'),
  syncScheduleHourly: t('settingsSyncScheduleHourly'),
  syncScheduleLabel: t('settingsSyncScheduleLabel'),
  syncStateLabel: (state: string) =>
    ({
      disconnected: t('settingsSyncStateDisconnected'),
      connecting: t('settingsSyncStateConnecting'),
      idle: t('settingsSyncStateIdle'),
      pulling: t('settingsSyncStatePulling'),
      merging: t('settingsSyncStateMerging'),
      pushing: t('settingsSyncStatePushing'),
      conflict: t('settingsSyncStateConflict'),
      degraded: t('settingsSyncStateDegraded')
    })[state] ?? t('settingsSyncStateDegraded'),
  syncTitle: t('settingsSyncTitle'),
  syncRecoveryTitle: t('settingsSyncRecoveryTitle'),
  syncRecoveryDescription: t('settingsSyncRecoveryDescription'),
  syncRecoveryRevisionLabel: (revision: number) =>
    t('settingsSyncRecoveryRevisionLabel', String(revision)),
  syncRecoveryDiffLabel: (added: number, changed: number, removed: number) =>
    t('settingsSyncRecoveryDiffLabel', [
      String(added),
      String(changed),
      String(removed)
    ]),
  syncRecoveryRestoreAction: t('settingsSyncRecoveryRestoreAction'),
  syncRecoveryReviewTitle: t('settingsSyncRecoveryReviewTitle'),
  syncRecoveryReviewBody: t('settingsSyncRecoveryReviewBody'),
  syncRecoveryConfirmAction: t('settingsSyncRecoveryConfirmAction'),
  syncRecoveryRestoredTitle: t('settingsSyncRecoveryRestoredTitle'),
  syncRecoveryRestoredBody: t('settingsSyncRecoveryRestoredBody'),
  syncRemoteDeleteAction: t('settingsSyncRemoteDeleteAction'),
  syncRemoteDeleteReviewTitle: t('settingsSyncRemoteDeleteReviewTitle'),
  syncRemoteDeleteReviewBody: (target: string) =>
    t('settingsSyncRemoteDeleteReviewBody', target),
  syncRemoteDeleteConfirmationLabel: t(
    'settingsSyncRemoteDeleteConfirmationLabel'
  ),
  syncRemoteDeleteConfirmAction: t('settingsSyncRemoteDeleteConfirmAction'),
  syncRemoteDeletedTitle: t('settingsSyncRemoteDeletedTitle'),
  syncRemoteDeletedBody: t('settingsSyncRemoteDeletedBody'),
  hideSecretAction: t('settingsHideSecretAction'),
  hoursLabel: (hours: number) => t('settingsHoursLabel', String(hours)),
  inheritOption: t('settingsInheritOption'),
  interfaceTitle: t('settingsInterfaceTitle'),
  generalDescription: t('settingsGeneralDescription'),
  generalModelCount: (count: number) =>
    count === 1
      ? t('settingsGeneralModelCountSingular')
      : t('settingsGeneralModelCount', String(count)),
  generalProviderCount: (count: number) =>
    count === 1
      ? t('settingsGeneralProviderCountSingular')
      : t('settingsGeneralProviderCount', String(count)),
  generalTitle: t('settingsGeneralTitle'),
  aiNavigationLabel: t('settingsAiNavigationLabel'),
  privacyDataAction: t('settingsPrivacyDataAction'),
  privacyDataDescription: t('settingsPrivacyDataDescription'),
  privacyDataTitle: t('settingsPrivacyDataTitle'),
  diagnosticsAction: t('settingsDiagnosticsAction'),
  diagnosticsDescription: t('settingsDiagnosticsDescription'),
  diagnosticsTitle: t('settingsDiagnosticsTitle'),
  localeAuto: t('settingsLocaleAuto'),
  localeEnglish: t('settingsLocaleEnglish'),
  localeLabel: t('settingsLocaleLabel'),
  localePortuguese: t('settingsLocalePortuguese'),
  localeSpanish: t('settingsLocaleSpanish'),
  loadingBody: t('settingsLoadingBody'),
  loadingTitle: t('settingsLoadingTitle'),
  maxConcurrentGlobalLabel: t('settingsMaxConcurrentGlobalLabel'),
  maxConcurrentProviderLabel: t('settingsMaxConcurrentProviderLabel'),
  modelDisplayLabel: t('settingsModelDisplayLabel'),
  modelCatalogTitle: t('settingsModelCatalogTitle'),
  catalogRefreshAction: t('settingsCatalogRefreshAction'),
  catalogRefreshedTitle: t('settingsCatalogRefreshedTitle'),
  catalogRefreshedBody: (count: number) =>
    t('settingsCatalogRefreshedBody', String(count)),
  modelCatalogStatusLabel: t('settingsModelCatalogStatusLabel'),
  modelCatalogStatusAvailable: t('settingsModelCatalogStatusAvailable'),
  modelCatalogStatusUnavailable: t('settingsModelCatalogStatusUnavailable'),
  modelCatalogStatusInvalid: t('settingsModelCatalogStatusInvalid'),
  modelDeclaredVersionLabel: t('settingsModelDeclaredVersionLabel'),
  modelInputLimitLabel: t('settingsModelInputLimitLabel'),
  modelLanguagesLabel: t('settingsModelLanguagesLabel'),
  modelLastCheckedLabel: t('settingsModelLastCheckedLabel'),
  modelModalitiesLabel: t('settingsModelModalitiesLabel'),
  modelModalityImage: t('settingsModelModalityImage'),
  modelModalityText: t('settingsModelModalityText'),
  modelOutputLimitLabel: t('settingsModelOutputLimitLabel'),
  modelInputPriceLabel: t('settingsModelInputPriceLabel'),
  modelOutputPriceLabel: t('settingsModelOutputPriceLabel'),
  modelPriceSourceLabel: t('settingsModelPriceSourceLabel'),
  modelProviderNameLabel: t('settingsModelProviderNameLabel'),
  modelVerificationLabel: t('settingsModelVerificationLabel'),
  modelVerificationDeclared: t('settingsModelVerificationDeclared'),
  modelVerificationProbe: t('settingsModelVerificationProbe'),
  modelVerificationBenchmark: t('settingsModelVerificationBenchmark'),
  modelVersionUnknown: t('settingsModelVersionUnknown'),
  modelIdLabel: t('settingsModelIdLabel'),
  modelProviderLabel: t('settingsModelProviderLabel'),
  modelSearchLabel: t('settingsModelSearchLabel'),
  modelTasksLabel: t('settingsModelTasksLabel'),
  modelsEmpty: t('settingsModelsEmpty'),
  modelsTitle: t('settingsModelsTitle'),
  monetaryBudgetDescription: t('settingsMonetaryBudgetDescription'),
  monetaryBudgetLabel: t('settingsMonetaryBudgetLabel'),
  monetaryCurrencyLabel: t('settingsMonetaryCurrencyLabel'),
  monetaryLimitLabel: t('settingsMonetaryLimitLabel'),
  noFallbackOption: t('settingsNoFallbackOption'),
  nativeFeedbackAvailableBody: t('settingsNativeFeedbackAvailableBody'),
  nativeFeedbackAvailableTitle: t('settingsNativeFeedbackAvailableTitle'),
  nativeFeedbackTitle: t('settingsNativeFeedbackTitle'),
  nativeFeedbackToggleLabel: t('settingsNativeFeedbackToggleLabel'),
  nativeFeedbackUnavailableBody: t('settingsNativeFeedbackUnavailableBody'),
  nativeFeedbackUnavailableTitle: t('settingsNativeFeedbackUnavailableTitle'),
  pendingAction: t('settingsPendingAction'),
  permissionBody: t('settingsPermissionBody'),
  permissionDenied: t('settingsPermissionDenied'),
  permissionGranted: t('settingsPermissionGranted'),
  permissionRequestAction: t('settingsPermissionRequestAction'),
  platformActivationLabel: t('settingsPlatformActivationLabel'),
  platformDisabled: t('settingsPlatformDisabled'),
  platformEnabled: t('settingsPlatformEnabled'),
  platformPaused: t('settingsPlatformPaused'),
  platformRoutingTitle: t('settingsPlatformRoutingTitle'),
  platformSelectLabel: t('settingsPlatformSelectLabel'),
  providerDisplayLabel: t('settingsProviderDisplayLabel'),
  providerEmpty: t('settingsProviderEmpty'),
  providerUpdatedBody: t('settingsProviderUpdatedBody'),
  providerUpdatedTitle: t('settingsProviderUpdatedTitle'),
  providerRemovedBody: t('settingsProviderRemovedBody'),
  providerRemovedTitle: t('settingsProviderRemovedTitle'),
  removeProviderBlockedBody: t('settingsRemoveProviderBlockedBody'),
  removeProviderBlockedTitle: t('settingsRemoveProviderBlockedTitle'),
  removeProviderCancelAction: t('settingsRemoveProviderCancelAction'),
  removeProviderConfirmAction: t('settingsRemoveProviderConfirmAction'),
  removeProviderFallbackRole: t('settingsRemoveProviderFallbackRole'),
  removeProviderModelsLabel: t('settingsRemoveProviderModelsLabel'),
  removeProviderPrimaryRole: t('settingsRemoveProviderPrimaryRole'),
  removeProviderReviewAction: t('settingsRemoveProviderReviewAction'),
  removeProviderReviewBody: t('settingsRemoveProviderReviewBody'),
  removeProviderReviewRoutesAction: t(
    'settingsRemoveProviderReviewRoutesAction'
  ),
  removeProviderReviewTitle: t('settingsRemoveProviderReviewTitle'),
  removeProviderRoutesLabel: t('settingsRemoveProviderRoutesLabel'),
  providerPermissionAction: t('settingsProviderPermissionAction'),
  providerPermissionBody: t('settingsProviderPermissionBody'),
  providerModelsLabel: t('settingsProviderModelsLabel'),
  providerModelCount: (count: number) =>
    t('settingsProviderModelCount', String(count)),
  providerSelectLabel: t('settingsProviderSelectLabel'),
  providerStatusLabel: t('settingsProviderStatusLabel'),
  providerTypeLabel: t('settingsProviderTypeLabel'),
  providerLastVerificationLabel: t('settingsProviderLastVerificationLabel'),
  providerTemplateLabel: t('settingsProviderTemplateLabel'),
  providersTitle: t('settingsProvidersTitle'),
  quotaAcknowledgement: t('settingsQuotaAcknowledgement'),
  priceMaxAgeLabel: t('settingsPriceMaxAgeLabel'),
  requestsPerDayLabel: t('settingsRequestsPerDayLabel'),
  requestsPerMinuteLabel: t('settingsRequestsPerMinuteLabel'),
  retryAction: t('panelRetryAction'),
  revealSecretAction: t('settingsRevealSecretAction'),
  routingBudgetsSummary: t('settingsRoutingBudgetsSummary'),
  saveAction: t('settingsSaveAction'),
  saveCredentialAction: t('settingsSaveCredentialAction'),
  saveFailedBody: t('settingsSaveFailedBody'),
  saveFailedTitle: t('settingsSaveFailedTitle'),
  savedBody: t('settingsSavedBody'),
  savedTitle: t('settingsSavedTitle'),
  surfacesTitle: t('settingsSurfacesTitle'),
  tabAiProviders: t('settingsTabAiProviders'),
  tabDiagnostics: t('settingsTabDiagnostics'),
  tabGeneral: t('settingsTabGeneral'),
  tabInterface: t('settingsTabInterface'),
  tabModels: t('settingsTabModels'),
  tabPlatforms: t('settingsTabPlatforms'),
  tabPrivacyData: t('settingsTabPrivacyData'),
  tabProviders: t('settingsTabProviders'),
  testConnectionAction: t('settingsTestConnectionAction'),
  testConnectionHint: t('settingsTestConnectionHint'),
  textOnlyBody: t('settingsTextOnlyBody'),
  textOnlyTitle: t('settingsTextOnlyTitle'),
  title: t('settingsTitle'),
  unsavedBody: t('settingsUnsavedBody'),
  unsavedContinueAction: t('settingsUnsavedContinueAction'),
  unsavedDiscardAction: t('settingsUnsavedDiscardAction'),
  unsavedSaveAction: t('settingsUnsavedSaveAction'),
  unsavedTitle: t('settingsUnsavedTitle')
})

export const getPlatformLabel = (platform: Platform) =>
  ({
    youtube: t('settingsPlatformYoutube'),
    linkedin: t('settingsPlatformLinkedin'),
    x: t('settingsPlatformX'),
    reddit: t('settingsPlatformReddit'),
    'hacker-news': t('settingsPlatformHackerNews'),
    rss: t('settingsPlatformRss')
  })[platform]

export const getTaskLabel = (task: ModelTask) =>
  ({
    'classification-text': t('settingsTaskClassificationText'),
    'classification-vision': t('settingsTaskClassificationVision'),
    embedding: t('settingsTaskEmbedding'),
    'assistance-draft': t('settingsTaskAssistanceDraft'),
    'assistance-explain': t('settingsTaskAssistanceExplain')
  })[task]

export const getProviderStatusLabel = (status: ProviderDescriptor['status']) =>
  ({
    unconfigured: t('settingsStatusUnconfigured'),
    locked: t('settingsStatusLocked'),
    ready: t('settingsStatusReady'),
    degraded: t('settingsStatusDegraded'),
    'rate-limited': t('settingsStatusRateLimited'),
    unauthorized: t('settingsStatusUnauthorized'),
    revoked: t('settingsStatusRevoked')
  })[status]

export const getProviderExecutionLabel = (
  execution: ProviderDescriptor['execution']
) =>
  ({
    local: t('settingsExecutionLocal'),
    cloud: t('settingsExecutionCloud'),
    browser: t('settingsExecutionBrowser')
  })[execution]

export const getPermissionStateLabel = (
  state: PlatformSettings['permissionState']
) =>
  ({
    'not-requested': t('settingsPermissionNotRequested'),
    granted: t('settingsPermissionGranted'),
    denied: t('settingsPermissionDenied'),
    revoked: t('settingsPermissionRevoked'),
    unavailable: t('settingsPermissionUnavailable')
  })[state]

export const getPlatformSurfaceLabel = (surface: PlatformSurface) =>
  ({
    'youtube:home': t('settingsSurfaceYoutubeHome'),
    'youtube:search': t('settingsSurfaceYoutubeSearch'),
    'youtube:recommendations': t('settingsSurfaceYoutubeRecommendations'),
    'youtube:subscriptions': t('settingsSurfaceYoutubeSubscriptions'),
    'youtube:shorts': t('settingsSurfaceYoutubeShorts'),
    'youtube:channel': t('settingsSurfaceYoutubeChannel'),
    'youtube:playlist': t('settingsSurfaceYoutubePlaylist'),
    'youtube:end-screen': t('settingsSurfaceYoutubeEndScreen'),
    'linkedin:feed': t('settingsSurfaceLinkedinFeed'),
    'linkedin:reposts': t('settingsSurfaceLinkedinReposts'),
    'linkedin:promoted-posts': t('settingsSurfaceLinkedinPromotedPosts'),
    'linkedin:comment-preview': t('settingsSurfaceLinkedinCommentPreview'),
    'x:following': t('settingsSurfaceXFollowing'),
    'x:for-you': t('settingsSurfaceXForYou'),
    'x:replies': t('settingsSurfaceXReplies'),
    'x:quoted-posts': t('settingsSurfaceXQuotedPosts'),
    'x:threads': t('settingsSurfaceXThreads'),
    'reddit:home': t('settingsSurfaceRedditHome'),
    'reddit:popular': t('settingsSurfaceRedditPopular'),
    'reddit:all': t('settingsSurfaceRedditAll'),
    'reddit:subreddit': t('settingsSurfaceRedditSubreddit'),
    'reddit:search': t('settingsSurfaceRedditSearch'),
    'reddit:comments': t('settingsSurfaceRedditComments'),
    'hacker-news:front-page': t('settingsSurfaceHackerNewsFrontPage'),
    'hacker-news:new': t('settingsSurfaceHackerNewsNew'),
    'hacker-news:best': t('settingsSurfaceHackerNewsBest'),
    'hacker-news:ask': t('settingsSurfaceHackerNewsAsk'),
    'hacker-news:show': t('settingsSurfaceHackerNewsShow'),
    'hacker-news:jobs': t('settingsSurfaceHackerNewsJobs'),
    'hacker-news:item': t('settingsSurfaceHackerNewsItem'),
    'rss:feed-entry': t('settingsSurfaceRssFeedEntry')
  })[surface]

export const getProviderConnectionTitle = (code: ProviderConnectionCode) =>
  ({
    'provider-connection-ready': t('settingsConnectionReadyTitle'),
    'provider-connection-authentication-failed': t(
      'settingsConnectionAuthenticationFailedTitle'
    ),
    'provider-connection-authorization-failed': t(
      'settingsConnectionAuthorizationFailedTitle'
    ),
    'provider-connection-tls-failed': t('settingsConnectionTlsFailedTitle'),
    'provider-connection-host-unreachable': t(
      'settingsConnectionHostUnreachableTitle'
    ),
    'provider-connection-rate-limited': t('settingsConnectionRateLimitedTitle'),
    'provider-connection-quota-exhausted': t(
      'settingsConnectionQuotaExhaustedTitle'
    ),
    'provider-connection-model-unavailable': t(
      'settingsConnectionModelUnavailableTitle'
    ),
    'provider-connection-schema-invalid': t(
      'settingsConnectionSchemaInvalidTitle'
    ),
    'provider-connection-protocol-invalid': t(
      'settingsConnectionProtocolInvalidTitle'
    ),
    'provider-connection-timeout': t('settingsConnectionTimeoutTitle'),
    'provider-connection-offline': t('settingsConnectionOfflineTitle'),
    'provider-connection-cancelled': t('settingsConnectionCancelledTitle'),
    'provider-connection-permission-denied': t(
      'settingsConnectionPermissionDeniedTitle'
    ),
    'provider-connection-credential-locked': t(
      'settingsConnectionCredentialLockedTitle'
    ),
    'provider-connection-credential-unavailable': t(
      'settingsConnectionCredentialUnavailableTitle'
    )
  })[code]

export type SettingsPanelCopy = ReturnType<typeof getSettingsPanelCopy>
