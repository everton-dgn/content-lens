import { z } from 'zod'

import { nonEmptyStringSchema } from '@/core/content/contracts'
import {
  credentialBindingSchema,
  wrappedCredentialEnvelopeSchema
} from '@/security/credentials/crypto-envelope'

const referenceSchema = nonEmptyStringSchema.max(256)

const baseRecordShape = {
  schemaVersion: z.literal(1),
  reference: referenceSchema,
  binding: credentialBindingSchema
}

const sessionCredentialRecordSchema = z.strictObject({
  ...baseRecordShape,
  mode: z.literal('session-only')
})

const wrappedCredentialRecordSchema = z.strictObject({
  ...baseRecordShape,
  mode: z.literal('passphrase-wrapped'),
  envelope: wrappedCredentialEnvelopeSchema
})

const externalCredentialRecordSchema = z
  .strictObject({
    ...baseRecordShape,
    mode: z.literal('external-vault'),
    externalReference: nonEmptyStringSchema.max(256),
    proxyCredentialMode: z.enum(['none', 'session-only', 'passphrase-wrapped']),
    envelope: wrappedCredentialEnvelopeSchema.optional()
  })
  .superRefine((record, context) => {
    const requiresEnvelope = record.proxyCredentialMode === 'passphrase-wrapped'
    if (requiresEnvelope !== (record.envelope !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'External proxy envelope does not match its credential mode',
        path: ['envelope']
      })
    }
  })

export const credentialDurableRecordSchema = z.discriminatedUnion('mode', [
  sessionCredentialRecordSchema,
  wrappedCredentialRecordSchema,
  externalCredentialRecordSchema
])

export type CredentialDurableRecord = z.infer<
  typeof credentialDurableRecordSchema
>
