import { describe, expect, it } from 'vitest'

import {
  MIN_PBKDF2_ITERATIONS,
  unwrapCredential,
  wrapCredential,
  wrappedCredentialEnvelopeSchema
} from '@/security/credentials/crypto-envelope'
import { CredentialVault } from '@/security/credentials/vault'

const binding = {
  providerConfigId: 'provider:fixture',
  endpointOrigin: 'https://provider.example'
}

describe('provider credential envelope', () => {
  it('uses the specified KDF, salt, IV and authenticated binding', async () => {
    const envelope = await wrapCredential({
      value: 'credential-canary-fixture',
      passphrase: 'a sufficiently long passphrase',
      binding
    })

    expect(wrappedCredentialEnvelopeSchema.parse(envelope)).toEqual(envelope)
    expect(envelope.kdf).toMatchObject({
      algorithm: 'PBKDF2-HMAC-SHA-256',
      iterations: MIN_PBKDF2_ITERATIONS
    })
    expect(Buffer.from(envelope.kdf.salt, 'base64')).toHaveLength(16)
    expect(Buffer.from(envelope.cipher.iv, 'base64')).toHaveLength(12)
    expect(JSON.stringify(envelope)).not.toContain('credential-canary-fixture')
    expect(
      await unwrapCredential({
        envelope,
        passphrase: 'a sufficiently long passphrase',
        binding
      })
    ).toBe('credential-canary-fixture')
  })

  it('uses one indistinguishable failure for a bad passphrase or binding', async () => {
    const envelope = await wrapCredential({
      value: 'credential-canary-fixture',
      passphrase: 'a sufficiently long passphrase',
      binding
    })

    await expect(
      unwrapCredential({
        envelope,
        passphrase: 'a different long passphrase',
        binding
      })
    ).rejects.toThrow('credential-unlock-failed')
    await expect(
      unwrapCredential({
        envelope,
        passphrase: 'a sufficiently long passphrase',
        binding: {
          ...binding,
          endpointOrigin: 'https://other-provider.example'
        }
      })
    ).rejects.toThrow('credential-unlock-failed')
  })

  it('keeps session and wrapped values behind an opaque reference', async () => {
    const vault = new CredentialVault()
    const sessionRef = await vault.storeSession(
      binding,
      'credential-canary-session'
    )
    const wrappedRef = await vault.storeWrapped(
      binding,
      'credential-canary-wrapped',
      'a sufficiently long passphrase'
    )

    expect(sessionRef).toMatch(/^credential:/)
    expect(wrappedRef).toMatch(/^credential:/)
    expect(JSON.stringify(vault.metadata())).not.toContain('credential-canary')
    await expect(
      vault.use(sessionRef, binding, async value => value.length)
    ).resolves.toBe('credential-canary-session'.length)
    await expect(
      vault.use(wrappedRef, binding, async value => value.length)
    ).rejects.toThrow('credential-locked')

    await vault.unlock(wrappedRef, binding, 'a sufficiently long passphrase')
    await expect(
      vault.use(wrappedRef, binding, async value => value)
    ).resolves.toBe('credential-canary-wrapped')
    await vault.remove(wrappedRef)
    await expect(
      vault.use(wrappedRef, binding, async value => value)
    ).rejects.toThrow('credential-unavailable')
  })

  it('never transfers a credential reference to another origin', async () => {
    const vault = new CredentialVault()
    const reference = await vault.storeSession(
      binding,
      'credential-canary-session'
    )

    await expect(
      vault.use(
        reference,
        { ...binding, endpointOrigin: 'https://other-provider.example' },
        async value => value
      )
    ).rejects.toThrow('credential-unavailable')
  })
})
