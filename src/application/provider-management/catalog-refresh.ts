import { z } from 'zod'

import {
  type ModelDescriptor,
  modelDescriptorSchema
} from '@/ai/models/contracts'
import type { ProviderDescriptor } from '@/ai/providers/contracts'
import { executeProviderJsonGet } from '@/ai/providers/request-policy'
import type { ProviderPermissionProbe } from '@/application/provider-management/connection-test'
import type { CredentialVault } from '@/security/credentials/vault'

const modelIdSchema = z.string().trim().min(1).max(256)
const openAiResponseSchema = z.object({
  data: z.array(z.object({ id: modelIdSchema })).max(5_000)
})
const anthropicResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: modelIdSchema,
        display_name: z.string().trim().min(1).max(256).optional()
      })
    )
    .max(5_000),
  has_more: z.boolean(),
  last_id: modelIdSchema.nullable().optional()
})
const geminiResponseSchema = z.object({
  models: z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .regex(/^models\/[A-Za-z0-9._:-]+$/),
        baseModelId: modelIdSchema.optional(),
        version: z.string().trim().min(1).max(128).optional(),
        displayName: z.string().trim().min(1).max(256).optional()
      })
    )
    .max(5_000),
  nextPageToken: z.string().trim().min(1).max(2_048).optional()
})
const ollamaResponseSchema = z.object({
  models: z
    .array(
      z.object({
        model: modelIdSchema.optional(),
        name: modelIdSchema
      })
    )
    .max(5_000)
})

type CatalogPlan = {
  authentication:
    | 'none'
    | 'authorization-bearer'
    | 'x-api-key'
    | 'x-goog-api-key'
  headers?: Readonly<Record<string, string>>
  pagination: 'none' | 'anthropic' | 'gemini'
  path: string
}

type CatalogEntry = {
  declaredVersion?: string
  displayName?: string
  modelId: string
}

const MAX_CATALOG_MODELS = 5_000
const MAX_CATALOG_PAGES = 25

function planFor(provider: ProviderDescriptor): CatalogPlan {
  switch (provider.kind) {
    case 'openai':
    case 'openai-compatible':
      return {
        authentication: 'authorization-bearer',
        pagination: 'none',
        path: '/v1/models'
      }
    case 'anthropic':
      return {
        authentication: 'x-api-key',
        headers: { 'anthropic-version': '2023-06-01' },
        pagination: 'anthropic',
        path: '/v1/models'
      }
    case 'gemini':
      return {
        authentication: 'x-goog-api-key',
        pagination: 'gemini',
        path: '/v1beta/models'
      }
    case 'ollama':
      return {
        authentication: 'none',
        pagination: 'none',
        path: '/api/tags'
      }
    case 'browser-built-in':
    case 'custom':
    case 'user-proxy':
      throw new Error('provider-catalog-refresh-unsupported')
  }
}

function parseCatalogPage(
  provider: ProviderDescriptor,
  input: unknown
): { entries: CatalogEntry[]; nextCursor?: string } {
  switch (provider.kind) {
    case 'openai':
    case 'openai-compatible':
      return {
        entries: openAiResponseSchema.parse(input).data.map(({ id }) => ({
          modelId: id
        }))
      }
    case 'anthropic': {
      const page = anthropicResponseSchema.parse(input)
      if (page.has_more && !page.last_id) {
        throw new Error('provider-catalog-pagination-invalid')
      }
      return {
        entries: page.data.map(model => ({
          modelId: model.id,
          ...(model.display_name ? { displayName: model.display_name } : {})
        })),
        ...(page.has_more && page.last_id ? { nextCursor: page.last_id } : {})
      }
    }
    case 'gemini': {
      const page = geminiResponseSchema.parse(input)
      return {
        entries: page.models.map(model => ({
          modelId: model.baseModelId ?? model.name.slice('models/'.length),
          ...(model.displayName ? { displayName: model.displayName } : {}),
          ...(model.version ? { declaredVersion: model.version } : {})
        })),
        ...(page.nextPageToken ? { nextCursor: page.nextPageToken } : {})
      }
    }
    case 'ollama':
      return {
        entries: ollamaResponseSchema.parse(input).models.map(model => ({
          modelId: model.model ?? model.name,
          displayName: model.name
        }))
      }
    case 'browser-built-in':
    case 'custom':
    case 'user-proxy':
      throw new Error('provider-catalog-refresh-unsupported')
  }
}

function toModelDescriptors(
  provider: ProviderDescriptor,
  entries: readonly CatalogEntry[],
  checkedAt: string
): ModelDescriptor[] {
  const unique = new Map<string, ModelDescriptor>()
  for (const entry of entries) {
    unique.set(
      entry.modelId,
      modelDescriptorSchema.parse({
        providerConfigId: provider.providerConfigId,
        modelId: entry.modelId,
        displayName: entry.displayName ?? entry.modelId,
        declaredVersion: entry.declaredVersion ?? null,
        executionKind: provider.execution,
        catalogSource: 'provider',
        lastCheckedAt: checkedAt,
        status: 'available',
        capabilities: []
      })
    )
  }
  return [...unique.values()].sort((left, right) =>
    left.modelId.localeCompare(right.modelId, 'en')
  )
}

export async function refreshProviderCatalog(input: {
  checkedAt: string
  fetchImpl?: typeof fetch
  permissions: ProviderPermissionProbe
  provider: ProviderDescriptor
  signal?: AbortSignal
  userInitiated: boolean
  vault: CredentialVault
}): Promise<ModelDescriptor[]> {
  if (!input.userInitiated) {
    throw new Error('provider-catalog-refresh-user-gesture-required')
  }
  if (
    input.provider.status === 'revoked' ||
    input.provider.execution === 'browser'
  ) {
    throw new Error('provider-catalog-refresh-unavailable')
  }
  const plan = planFor(input.provider)
  const authenticationData =
    plan.authentication === 'none' ? [] : (['authenticationInfo'] as const)
  const permitted = await input.permissions.has(
    {
      endpointOrigin: input.provider.endpointOrigin,
      execution: input.provider.execution
    },
    authenticationData
  )
  if (!permitted) {
    throw new Error('provider-catalog-refresh-permission-denied')
  }
  const requestAllPages = async (credential?: string) => {
    const entries: CatalogEntry[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (let pageNumber = 0; pageNumber < MAX_CATALOG_PAGES; pageNumber += 1) {
      const query =
        plan.pagination === 'anthropic'
          ? {
              limit: '1000',
              ...(cursor ? { after_id: cursor } : {})
            }
          : plan.pagination === 'gemini'
            ? {
                pageSize: '1000',
                ...(cursor ? { pageToken: cursor } : {})
              }
            : undefined
      const response = await executeProviderJsonGet({
        endpointOrigin: input.provider.endpointOrigin,
        execution: input.provider.execution,
        path: plan.path,
        ...(query ? { query } : {}),
        ...(plan.headers ? { headers: plan.headers } : {}),
        ...(credential && plan.authentication !== 'none'
          ? {
              credential: {
                authentication: plan.authentication,
                value: credential
              }
            }
          : {}),
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {})
      })
      const parsed = parseCatalogPage(input.provider, response)
      entries.push(...parsed.entries)
      if (entries.length > MAX_CATALOG_MODELS) {
        throw new Error('provider-catalog-model-limit-exceeded')
      }
      if (!parsed.nextCursor) {
        return toModelDescriptors(input.provider, entries, input.checkedAt)
      }
      if (cursors.has(parsed.nextCursor)) {
        throw new Error('provider-catalog-pagination-loop')
      }
      cursors.add(parsed.nextCursor)
      cursor = parsed.nextCursor
    }
    throw new Error('provider-catalog-page-limit-exceeded')
  }
  if (plan.authentication === 'none') {
    return requestAllPages()
  }
  if (!input.provider.credentialRef) {
    throw new Error('credential-unavailable')
  }
  return input.vault.use(
    input.provider.credentialRef,
    {
      providerConfigId: input.provider.providerConfigId,
      endpointOrigin: input.provider.endpointOrigin
    },
    requestAllPages
  )
}
