# ADR 0014: Browser support, manifests and permissions

Status: Accepted, security amendment applied 2026-08-12

## Context

The feasibility contract blocks production implementation until packaged
Chrome and Firefox evidence resolves browser
support, the Firefox manifest strategy, the reference device and the minimum
permission set. The foundation kept OQ-002 and OQ-012 open while those facts
were untested.

The packaged browser tests cover synthetic YouTube Home, search and related
fixtures, reversible rendering, worker interruption, replay, IndexedDB and
runtime messaging without an authenticated browsing session.

## Considered options

1. Support Chrome MV3 and Firefox MV2 from the shared WXT codebase.
2. Require MV3 in both browsers before production implementation.
3. Release a Chrome-only baseline and defer Firefox.

Option 1 matches the two packaged manifest and lifecycle paths that passed.
Option 2 would discard the passing Firefox MV2 evidence without a product or
security benefit. Option 3 would reduce the accepted cross-browser scope.

## Decision

The initial stable support floor for the deterministic baseline is:

| Browser | Minimum version | Manifest | Baseline status |
| --- | --- | --- | --- |
| Chrome/Chromium | 149 | MV3 | Supported |
| Firefox Desktop | 151.0 | MV2 | Supported with optional-capability fallback |

The minimums are conservative tested floors. Earlier versions are unsupported
until a packaged run supplies equivalent evidence. A matching user-agent
version alone never enables a capability; runtime probes still control use.

Chrome declares `minimum_chrome_version: "149"` and uses the `sidePanel` and
`scripting` permissions. Firefox declares `strict_min_version: "151.0"`, uses
the stable extension ID `{b83fdbe3-ec9c-453e-8a61-72d4cfc6dd4e}` and uses
`scripting`; `sidebar_action` itself needs no API permission. Production
packages contain no static content-script match. The service worker registers
one exact platform origin only after the platform is enabled and its optional
host permission is present, then unregisters it on disable or revocation.

The required deterministic browser capabilities are extension runtime
messaging, IndexedDB, the selected extension-owned panel surface and the
content-script boundary. WebGPU is optional. A missing or unusable WebGPU
adapter moves the runtime to `degraded` while deterministic behavior remains
available.

The provider implementation adds a second permission class. Provider origins
are declared as optional manifest capabilities and granted one normalized
origin at a time only after a named user action. A manifest wildcard declares
which optional origins the browser may offer later; it does not grant those
origins at installation.

## Evidence

The browser decision is backed by:

- [Worker restart integration tests](../../tests/browser/worker-restart.spec.ts)
  that terminate the Chrome service worker and reload the Firefox extension
  context after commit, then verify one logical effect after replay.
- [Reversible rendering integration tests](../../tests/browser/youtube-flow.spec.ts)
  that load packaged Chrome MV3 and Firefox MV2 builds.
- [YouTube fixture provenance](../datasets/youtube-fixtures.md) for the three
  tested surfaces.
- [Permission matrix](../security/permissions-matrix.md) for every manifest
  privilege and host boundary.
- [Provider connection contract tests](../../tests/contract/provider-connection.test.ts)
  for exact-origin permission checks, synthetic payloads, redacted outcomes
  and transactional state updates.
- [Provider runtime bootstrap tests](../../tests/contract/provider-runtime-bootstrap.test.ts)
  for rehydration and fail-closed worker startup.

The validation commands are:

```text
pnpm test:unit
pnpm test:browser
pnpm test:runtime
pnpm benchmark:phase0
pnpm build:chrome
pnpm build:firefox
pnpm exec playwright test tests/browser/panel-open-smoke.spec.ts
```

The YouTube adapter contract tests (`tests/contract/youtube-adapter.test.ts`)
run inside the `unit` project. Packaged browser journeys verify the current
manifest and extension-owned panel behavior.

## Permissions

The accepted production permission set is deliberately small:

- Chrome: `sidePanel`.
- Chrome and Firefox: `scripting` for runtime registration of exact platform
  content scripts after host approval.
- Firefox: no API permission for `sidebar_action` and no `dns` permission.
- Chrome and Firefox: production `content_scripts` remains empty and platform
  hosts are optional rather than granted at installation.
- Chrome: optional provider origins are declared in
  `optional_host_permissions` as `https://*/*` and `http://*/*`.
- Firefox MV2: the same optional origins are declared in
  `optional_permissions`, because MV2 does not emit
  `optional_host_permissions`.
- Firefox: `data_collection_permissions.required: ["none"]` and optional
  `authenticationInfo` plus `websiteContent`.

The manifests exclude `tabs`, `activeTab`, `storage`, history, cookies,
downloads, notifications, clipboard, required platform or provider hosts and
remote code. The provider connection and platform activation flows call
`permissions.request` only after the user selects the capability and confirms
the purpose. They request the exact normalized origin. Refusal leaves that
capability disabled, sends no request and does not trigger an automatic retry.

RSS and Atom network acquisition is disabled in both browser families. A DNS
lookup followed by `fetch(hostname)` has a time-of-check/time-of-use gap because
the browser resolves the hostname again for the real connection. The extension
does not request `dns`, schedule feed alarms or call `fetch` for a subscription.
Local parsing, stored subscription state and profile portability remain
available.

The connection test rechecks the exact origin and Firefox data-collection
grant before it accesses the vault. The request contains a packaged synthetic
prompt with no page, feed, profile or rule content. The result stores only a
finite code, outcome, latency and timestamp. It never stores an endpoint,
model ID, response body, header or credential.

## Tradeoffs

- Firefox MV2 and Chrome MV3 keep two lifecycle paths in the test matrix.
- Broad optional manifest patterns make arbitrary HTTPS and loopback HTTP
  origins selectable, while runtime normalization and exact-origin requests
  remain responsible for limiting each grant.
- The conservative version floors exclude older browsers that might work but
  have no packaged evidence.
- The initial Standard reference is stronger than many consumer devices, so
  support cannot yet be broadened through performance inference.
- Firefox keeps deterministic filtering when WebGPU is unavailable, but local
  model features remain disabled.
- RSS subscriptions cannot refresh from the network until a transport can bind
  an approved address to the actual connection while preserving TLS and host
  validation.

## Consequences

- OQ-002 and the deterministic portion of OQ-012 are resolved.
- Production manifests encode the accepted browser floors and stable Firefox
  identity.
- Browser releases at or above the declared floor still run capability probes
  before mutation.
- A provider cannot use the connection path without a user gesture, quota
  acknowledgement, current origin permission and an unlocked credential when
  its adapter requires authentication.
- Worker startup rehydrates provider state through the same IndexedDB used by
  the deterministic decision service. An unreadable provider snapshot disables
  provider operations without disabling deterministic decisions.
- Firefox MV3 remains unaccepted until it passes the same packaged lifecycle,
  rendering, permission and recovery matrix.
- Model-backed device classes remain blocked by their own model, quality,
  resource and license gates.
- RSS network actions remain visibly unavailable and the worker returns a
  finite unavailable result without performing network I/O.

## Validation

Every manifest change repeats both production builds, the packaged panel
smoke, provider permission and connection contracts, runtime interruption
tests and the capability benchmark. A browser floor can move only through the
deprecation contract or an active security or platform-policy exception.

Revisit this decision when Firefox MV3 passes the complete matrix, a lower
reference device passes every deterministic budget, or a browser API change
invalidates one of the required probes.
