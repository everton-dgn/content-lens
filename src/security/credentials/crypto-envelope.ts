import { z } from 'zod'

import { nonEmptyStringSchema } from '@/core/content/contracts'

export const MIN_PBKDF2_ITERATIONS = 600_000
const PASSPHRASE_MIN_BYTES = 12
const PASSPHRASE_MAX_BYTES = 1_024

const base64Schema = nonEmptyStringSchema.refine(value => {
  try {
    return bytesFromBase64(value).byteLength > 0
  } catch {
    return false
  }
}, 'Invalid base64 value')

export const credentialBindingSchema = z.strictObject({
  providerConfigId: nonEmptyStringSchema.max(256),
  endpointOrigin: nonEmptyStringSchema.max(2_048)
})

export const wrappedCredentialEnvelopeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    binding: credentialBindingSchema,
    kdf: z.strictObject({
      algorithm: z.literal('PBKDF2-HMAC-SHA-256'),
      iterations: z.int().min(MIN_PBKDF2_ITERATIONS),
      salt: base64Schema
    }),
    cipher: z.strictObject({
      algorithm: z.literal('AES-256-GCM'),
      iv: base64Schema,
      ciphertext: base64Schema
    })
  })
  .superRefine((envelope, context) => {
    if (bytesFromBase64(envelope.kdf.salt).byteLength !== 16) {
      context.addIssue({
        code: 'custom',
        message: 'Credential salt must be 16 bytes',
        path: ['kdf', 'salt']
      })
    }
    if (bytesFromBase64(envelope.cipher.iv).byteLength !== 12) {
      context.addIssue({
        code: 'custom',
        message: 'Credential IV must be 12 bytes',
        path: ['cipher', 'iv']
      })
    }
  })

export type CredentialBinding = z.infer<typeof credentialBindingSchema>
export type WrappedCredentialEnvelope = z.infer<
  typeof wrappedCredentialEnvelopeSchema
>

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function utf8(value: string) {
  return new TextEncoder().encode(value)
}

function aadFor(binding: CredentialBinding) {
  return utf8(
    JSON.stringify({
      schemaVersion: 1,
      algorithm: 'AES-256-GCM',
      providerConfigId: binding.providerConfigId,
      endpointOrigin: binding.endpointOrigin
    })
  )
}

function validatePassphrase(passphrase: string) {
  const byteLength = utf8(passphrase).byteLength
  if (byteLength < PASSPHRASE_MIN_BYTES || byteLength > PASSPHRASE_MAX_BYTES) {
    throw new TypeError('Passphrase length is invalid')
  }
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    utf8(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function wrapCredential(input: {
  value: string
  passphrase: string
  binding: CredentialBinding
}): Promise<WrappedCredentialEnvelope> {
  validatePassphrase(input.passphrase)
  const binding = credentialBindingSchema.parse(input.binding)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(input.passphrase, salt, MIN_PBKDF2_ITERATIONS)
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aadFor(binding),
      tagLength: 128
    },
    key,
    utf8(input.value)
  )
  return wrappedCredentialEnvelopeSchema.parse({
    schemaVersion: 1,
    binding,
    kdf: {
      algorithm: 'PBKDF2-HMAC-SHA-256',
      iterations: MIN_PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt)
    },
    cipher: {
      algorithm: 'AES-256-GCM',
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext))
    }
  })
}

export async function unwrapCredential(input: {
  envelope: WrappedCredentialEnvelope
  passphrase: string
  binding: CredentialBinding
}) {
  try {
    validatePassphrase(input.passphrase)
    const envelope = wrappedCredentialEnvelopeSchema.parse(input.envelope)
    const binding = credentialBindingSchema.parse(input.binding)
    const key = await deriveKey(
      input.passphrase,
      bytesFromBase64(envelope.kdf.salt),
      envelope.kdf.iterations
    )
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytesFromBase64(envelope.cipher.iv),
        additionalData: aadFor(binding),
        tagLength: 128
      },
      key,
      bytesFromBase64(envelope.cipher.ciphertext)
    )
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
  } catch {
    throw new Error('credential-unlock-failed')
  }
}
