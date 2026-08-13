# ADR 0010: Provider credential handling

Status: Accepted

## Context

Model providers and future sync providers may require credentials. Browser
extension storage does not provide a general secret vault against local-profile
compromise or a compromised privileged extension context.

## Problem

The project needs authentication with minimum privilege and lifetime without embedding client secrets or overstating local protection.

## Considered options

1. Store long-lived personal access tokens in extension storage.
2. Ask for a token on every session.
3. Persist a passphrase-wrapped envelope.
4. Keep the provider credential in a user-owned proxy or external vault.
5. Use provider-supported authorization with short-lived tokens and refresh controls.
6. Avoid network providers and use file export only.

## Decision

ContentLens accepts three credential modes behind one privileged vault boundary:

1. `session-only` is the default for direct BYOK. The current implementation
   keeps the value in memory and persists only its opaque reference and binding
   metadata. Context recreation returns the provider to a locked state.
2. `passphrase-wrapped` is an explicit opt-in. IndexedDB receives only the
   versioned PBKDF2-HMAC-SHA-256 and AES-256-GCM envelope bound to
   `providerConfigId` and normalized `endpointOrigin`.
3. `external-vault` is recommended for a user-owned proxy or vault. A proxy
   token, when required, follows either the session-only or wrapped boundary.

Provider descriptors, model descriptors and consent receipts use dedicated
non-secret stores. Credential records use a separate local store excluded from
the portable profile, export, sync, cache, diagnostics and evidence.

No credential enters page context, content scripts, URLs, export, sync payloads
or logs. No reusable client secret is bundled. Disconnect removes the local
credential record and consent receipts, and provider-specific revocation
guidance remains required.

OQ-007 remains open only for public-client authentication of future sync
providers. It does not block the accepted model-provider vault modes.

## Evaluation criteria

- Token lifetime and scope.
- Browser API support.
- Revocation.
- Recovery after extension restart.
- Exposure under XSS, malicious dependency and local-profile access.
- Provider policy and public-client requirements.

## Consequences

- Direct BYOK defaults to a context-lifetime value and may require re-entry.
- Wrapped persistence increases local convenience but does not protect against
  a compromised privileged extension context after unlock.
- Provider sync remains experimental until it selects a provider-specific
  public-client authentication flow.
- Documentation must state the limits of local credential protection.

## Revisit trigger

Revisit when a supported browser proves restricted `storage.session` behavior,
when a sync provider selects its public-client authentication flow, or when a
new credential mode changes the trust boundary.
