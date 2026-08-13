import { z } from 'zod'

import { verifySyncEnvelope } from '@/sync/canonical'
import { type SyncEnvelope, syncEnvelopeSchema } from '@/sync/contracts'
import {
  decryptPortableEnvelope,
  encryptPortableEnvelope
} from '@/sync/portability-crypto'
import {
  createPortabilityManifest,
  portabilityManifestMatches,
  portabilityManifestSchema
} from '@/sync/portability-manifest'

export const MAX_PORTABILITY_FILE_BYTES = 10 * 1024 * 1024

const plaintextPortabilityFileSchema = z.strictObject({
  format: z.literal('content-lens-portability'),
  version: z.literal(1),
  encryption: z.literal('none'),
  syncProfileId: z.string().min(1).max(256),
  generation: z.int().nonnegative(),
  manifest: portabilityManifestSchema,
  envelope: syncEnvelopeSchema
})

export type PlaintextPortabilityFile = z.infer<
  typeof plaintextPortabilityFileSchema
>

function withinLimit(raw: string) {
  return new TextEncoder().encode(raw).byteLength <= MAX_PORTABILITY_FILE_BYTES
}

function serialize(input: unknown) {
  const raw = `${JSON.stringify(input, null, 2)}\n`
  if (!withinLimit(raw)) {
    throw new RangeError('Portability file exceeds 10 MiB')
  }
  return raw
}

export async function serializePlaintextPortabilityFile(
  envelope: SyncEnvelope,
  createdAt: string
) {
  const verified = await verifySyncEnvelope(envelope)
  if (!verified.valid) {
    throw new TypeError('Cannot export an invalid sync envelope')
  }
  return serialize(
    plaintextPortabilityFileSchema.parse({
      format: 'content-lens-portability',
      version: 1,
      encryption: 'none',
      syncProfileId: verified.envelope.syncProfileId,
      generation: verified.envelope.generation,
      manifest: createPortabilityManifest(verified.envelope, createdAt),
      envelope: verified.envelope
    })
  )
}

export async function serializeEncryptedPortabilityFile(
  envelope: SyncEnvelope,
  passphrase: string,
  createdAt: string
) {
  return serialize(
    await encryptPortableEnvelope(envelope, passphrase, createdAt)
  )
}

export type PortabilityParseResult =
  | {
      state: 'ready'
      encrypted: boolean
      envelope: SyncEnvelope
    }
  | { state: 'passphrase-required' }
  | {
      state: 'invalid'
      code:
        | 'portability-decryption-failed'
        | 'portability-digest-mismatch'
        | 'portability-file-invalid'
        | 'portability-file-too-large'
    }

export async function parsePortabilityFile(
  raw: string,
  passphrase?: string
): Promise<PortabilityParseResult> {
  if (!withinLimit(raw)) {
    return { state: 'invalid', code: 'portability-file-too-large' }
  }
  let candidate: unknown
  try {
    candidate = JSON.parse(raw)
  } catch {
    return { state: 'invalid', code: 'portability-file-invalid' }
  }
  if (
    candidate !== null &&
    typeof candidate === 'object' &&
    'encryption' in candidate &&
    candidate.encryption === 'aes-256-gcm'
  ) {
    if (!passphrase) {
      return { state: 'passphrase-required' }
    }
    const decrypted = await decryptPortableEnvelope(candidate, passphrase)
    return decrypted.state === 'decrypted'
      ? { state: 'ready', encrypted: true, envelope: decrypted.envelope }
      : { state: 'invalid', code: decrypted.code }
  }
  const parsed = plaintextPortabilityFileSchema.safeParse(candidate)
  if (!parsed.success) {
    return { state: 'invalid', code: 'portability-file-invalid' }
  }
  const verified = await verifySyncEnvelope(parsed.data.envelope)
  if (
    !verified.valid ||
    parsed.data.syncProfileId !== parsed.data.envelope.syncProfileId ||
    parsed.data.generation !== parsed.data.envelope.generation ||
    !portabilityManifestMatches(parsed.data.manifest, parsed.data.envelope)
  ) {
    return { state: 'invalid', code: 'portability-digest-mismatch' }
  }
  return {
    state: 'ready',
    encrypted: false,
    envelope: verified.envelope
  }
}
