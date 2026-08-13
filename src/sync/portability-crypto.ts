import { z } from 'zod'

import { verifySyncEnvelope } from '@/sync/canonical'
import type { SyncEnvelope } from '@/sync/contracts'
import {
  createPortabilityManifest,
  portabilityManifestMatches,
  portabilityManifestSchema
} from '@/sync/portability-manifest'

const PORTABILITY_DOMAIN = 'content-lens-portability-v1'
const PORTABILITY_ITERATIONS = 600_000
const PORTABILITY_SALT_BYTES = 16
const PORTABILITY_IV_BYTES = 12
const PORTABILITY_KEY_BITS = 256
const PORTABILITY_TAG_BITS = 128
const MIN_PASSPHRASE_BYTES = 12
const MAX_PASSPHRASE_BYTES = 1_024
const MAX_ENCRYPTED_PAYLOAD_BYTES = 6 * 1024 * 1024

const portabilityCiphertextSchema = z.strictObject({
  format: z.literal('content-lens-portability'),
  version: z.literal(1),
  encryption: z.literal('aes-256-gcm'),
  syncProfileId: z.string().min(1).max(256),
  generation: z.int().nonnegative(),
  manifest: portabilityManifestSchema,
  kdf: z.strictObject({
    algorithm: z.literal('PBKDF2-HMAC-SHA-256'),
    iterations: z.literal(PORTABILITY_ITERATIONS),
    salt: z.string().min(1)
  }),
  cipher: z.strictObject({
    algorithm: z.literal('AES-256-GCM'),
    iv: z.string().min(1),
    tagBits: z.literal(PORTABILITY_TAG_BITS)
  }),
  payload: z.string().min(1)
})

export type PortabilityCiphertext = z.infer<typeof portabilityCiphertextSchema>

type PortabilityHeader = Omit<PortabilityCiphertext, 'payload'>

function passphraseBytes(passphrase: string) {
  const encoded = new TextEncoder().encode(passphrase)
  if (
    encoded.byteLength < MIN_PASSPHRASE_BYTES ||
    encoded.byteLength > MAX_PASSPHRASE_BYTES
  ) {
    throw new RangeError(
      `Portability passphrase must contain ${MIN_PASSPHRASE_BYTES} to ${MAX_PASSPHRASE_BYTES} UTF-8 bytes`
    )
  }
  return encoded
}

function toBase64(bytes: Uint8Array) {
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    )
  }
  return btoa(chunks.join(''))
}

function fromBase64(value: string, expectedBytes?: number) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new TypeError('Invalid portability base64')
  }
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) {
    throw new TypeError('Invalid portability field length')
  }
  return bytes
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const normalizedSalt = new Uint8Array(salt.byteLength)
  normalizedSalt.set(salt)
  const domainPassphrase = new Uint8Array([
    ...new TextEncoder().encode(PORTABILITY_DOMAIN),
    0,
    ...passphraseBytes(passphrase)
  ])
  const material = await crypto.subtle.importKey(
    'raw',
    domainPassphrase,
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PORTABILITY_ITERATIONS,
      salt: normalizedSalt
    },
    material,
    { name: 'AES-GCM', length: PORTABILITY_KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  )
}

function authenticatedMetadata(header: PortabilityHeader) {
  return new TextEncoder().encode(
    JSON.stringify({ domain: PORTABILITY_DOMAIN, ...header })
  )
}

export async function encryptPortableEnvelope(
  envelope: SyncEnvelope,
  passphrase: string,
  createdAt = new Date().toISOString()
): Promise<PortabilityCiphertext> {
  const verified = await verifySyncEnvelope(envelope)
  if (!verified.valid) {
    throw new TypeError('Cannot encrypt an invalid sync envelope')
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(verified.envelope))
  if (plaintext.byteLength > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    throw new RangeError('Portable envelope exceeds encrypted payload limit')
  }
  const salt = crypto.getRandomValues(new Uint8Array(PORTABILITY_SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(PORTABILITY_IV_BYTES))
  const key = await deriveKey(passphrase, salt)
  const header = {
    format: 'content-lens-portability' as const,
    version: 1 as const,
    encryption: 'aes-256-gcm' as const,
    syncProfileId: verified.envelope.syncProfileId,
    generation: verified.envelope.generation,
    manifest: createPortabilityManifest(verified.envelope, createdAt),
    kdf: {
      algorithm: 'PBKDF2-HMAC-SHA-256' as const,
      iterations: PORTABILITY_ITERATIONS,
      salt: toBase64(salt)
    },
    cipher: {
      algorithm: 'AES-256-GCM' as const,
      iv: toBase64(iv),
      tagBits: PORTABILITY_TAG_BITS
    }
  } satisfies PortabilityHeader
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: authenticatedMetadata(header),
      tagLength: PORTABILITY_TAG_BITS
    },
    key,
    plaintext
  )
  return portabilityCiphertextSchema.parse({
    ...header,
    payload: toBase64(new Uint8Array(encrypted))
  })
}

export async function decryptPortableEnvelope(
  input: unknown,
  passphrase: string
) {
  try {
    const parsed = portabilityCiphertextSchema.parse(input)
    const salt = fromBase64(parsed.kdf.salt, PORTABILITY_SALT_BYTES)
    const iv = fromBase64(parsed.cipher.iv, PORTABILITY_IV_BYTES)
    const payload = fromBase64(parsed.payload)
    if (payload.byteLength > MAX_ENCRYPTED_PAYLOAD_BYTES) {
      throw new RangeError('Encrypted payload exceeds limit')
    }
    const key = await deriveKey(passphrase, salt)
    const { payload: _payload, ...header } = parsed
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: authenticatedMetadata(header),
        tagLength: PORTABILITY_TAG_BITS
      },
      key,
      payload
    )
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
    const verified = await verifySyncEnvelope(JSON.parse(decoded))
    if (!verified.valid) {
      throw new TypeError('Invalid decrypted envelope')
    }
    if (
      verified.envelope.syncProfileId !== parsed.syncProfileId ||
      verified.envelope.generation !== parsed.generation ||
      !portabilityManifestMatches(parsed.manifest, verified.envelope)
    ) {
      throw new TypeError('Encrypted portability metadata mismatch')
    }
    return { state: 'decrypted' as const, envelope: verified.envelope }
  } catch {
    return {
      state: 'failed' as const,
      code: 'portability-decryption-failed' as const
    }
  }
}
