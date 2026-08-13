import { z } from 'zod'

import { modelDescriptorSchema } from '@/ai/models/contracts'
import {
  consentReceiptSchema,
  providerDescriptorSchema
} from '@/ai/providers/contracts'
import { credentialDurableRecordSchema } from '@/security/credentials/durable-record'

export const PROVIDER_STATE_SCHEMA_VERSION = 1

function addDuplicateIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
) {
  context.addIssue({
    code: 'custom',
    message,
    path
  })
}

export const providerStateSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(PROVIDER_STATE_SCHEMA_VERSION),
    providers: z.array(providerDescriptorSchema),
    models: z.array(modelDescriptorSchema),
    consents: z.array(consentReceiptSchema),
    credentials: z.array(credentialDurableRecordSchema)
  })
  .superRefine((snapshot, context) => {
    const providers = new Map(
      snapshot.providers.map(provider => [provider.providerConfigId, provider])
    )
    if (providers.size !== snapshot.providers.length) {
      addDuplicateIssue(context, ['providers'], 'Duplicate provider')
    }

    const modelKeys = snapshot.models.map(
      model => `${model.providerConfigId}\u0000${model.modelId}`
    )
    if (new Set(modelKeys).size !== modelKeys.length) {
      addDuplicateIssue(context, ['models'], 'Duplicate model')
    }

    const consentKeys = snapshot.consents.map(receipt =>
      JSON.stringify(receipt.key)
    )
    if (new Set(consentKeys).size !== consentKeys.length) {
      addDuplicateIssue(context, ['consents'], 'Duplicate consent receipt')
    }

    const credentials = new Map(
      snapshot.credentials.map(credential => [credential.reference, credential])
    )
    if (credentials.size !== snapshot.credentials.length) {
      addDuplicateIssue(context, ['credentials'], 'Duplicate credential')
    }

    snapshot.models.forEach((model, index) => {
      if (!providers.has(model.providerConfigId)) {
        context.addIssue({
          code: 'custom',
          message: 'Model references an unknown provider',
          path: ['models', index, 'providerConfigId']
        })
      }
    })

    snapshot.consents.forEach((receipt, index) => {
      const provider = providers.get(receipt.key.providerConfigId)
      if (!provider || provider.endpointOrigin !== receipt.key.endpointOrigin) {
        context.addIssue({
          code: 'custom',
          message: 'Consent references an unknown provider binding',
          path: ['consents', index, 'key']
        })
      }
    })

    snapshot.credentials.forEach((credential, index) => {
      const provider = providers.get(credential.binding.providerConfigId)
      if (
        !provider ||
        provider.endpointOrigin !== credential.binding.endpointOrigin
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Credential references an unknown provider binding',
          path: ['credentials', index, 'binding']
        })
      }
    })

    snapshot.providers.forEach((provider, index) => {
      if (!provider.credentialRef) {
        return
      }
      const credential = credentials.get(provider.credentialRef)
      if (
        !credential ||
        credential.binding.providerConfigId !== provider.providerConfigId ||
        credential.binding.endpointOrigin !== provider.endpointOrigin ||
        credential.mode !== provider.credentialMode
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Provider credential reference is inconsistent',
          path: ['providers', index, 'credentialRef']
        })
      }
    })
  })

export type ProviderStateSnapshot = z.infer<typeof providerStateSnapshotSchema>
