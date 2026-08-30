# ADR 0014: Browser support, manifests and permissions

Status: Accepted, support amendment applied 2026-08-30

## Context

The feasibility contract blocks production implementation until packaged
Chrome evidence resolves browser support, the reference device and the minimum
permission set. The foundation kept OQ-002 and OQ-012 open while those facts
were untested.

The packaged browser tests cover synthetic YouTube Home, search and related
fixtures, reversible rendering, worker interruption, replay, IndexedDB and
runtime messaging without an authenticated browsing session.

## Considered options

1. Support Chrome MV3 from the shared WXT codebase.
2. Require broader browser coverage before production implementation.
3. Defer the browser package until more platforms have passed the full matrix.

Option 1 matches the packaged manifest and lifecycle path maintained by the
product. Option 2 would expand the release contract without current product
scope. Option 3 would discard the passing Chrome evidence.

## Decision

The initial stable support floor for the deterministic baseline is:

| Browser | Minimum version | Manifest | Baseline status |
| --- | --- | --- | --- |
| Chrome/Chromium | 149 | MV3 | Supported |

The minimums are conservative tested floors. Earlier versions are unsupported
until a packaged run supplies equivalent evidence. A matching user-agent
version alone never enables a capability; runtime probes still control use.

Chrome declares `minimum_chrome_version: "149"` and uses the `sidePanel` and
`scripting` permissions. Production packages contain no static content-script
match. The service worker registers
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
  that terminate the Chrome service worker after commit, then verify one
  logical effect after replay.
- [Reversible rendering integration tests](../../tests/browser/youtube-flow.spec.ts)
  that load the packaged Chrome MV3 build.
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
pnpm exec playwright test tests/browser/panel-open-smoke.spec.ts
```

The YouTube adapter contract tests (`tests/contract/youtube-adapter.test.ts`)
run inside the `unit` project. Packaged browser journeys verify the current
manifest and extension-owned panel behavior.

## Permissions

The accepted production permission set is deliberately small:

- `sidePanel` opens the extension-owned interface.
- `scripting` registers exact platform content scripts after host approval.
- Production `content_scripts` remains empty and platform hosts are optional
  rather than granted at installation.
- Optional provider origins are declared in
  `optional_host_permissions` as `https://*/*` and `http://*/*`.

The manifests exclude `tabs`, `activeTab`, `storage`, history, cookies,
downloads, notifications, clipboard, required platform or provider hosts and
remote code. The provider connection and platform activation flows call
`permissions.request` only after the user selects the capability and confirms
the purpose. They request the exact normalized origin. Refusal leaves that
capability disabled, sends no request and does not trigger an automatic retry.

RSS and Atom network acquisition is disabled in the packaged browser. A DNS
lookup followed by `fetch(hostname)` has a time-of-check/time-of-use gap because
the browser resolves the hostname again for the real connection. The extension
does not request `dns`, schedule feed alarms or call `fetch` for a subscription.
Local parsing, stored subscription state and profile portability remain
available.

The connection test rechecks the exact origin before it accesses the vault. The
request contains a packaged synthetic prompt with no page, feed, profile or
rule content. The result stores only a finite code, outcome, latency and
timestamp. It never stores an endpoint, model ID, response body, header or
credential.

## Tradeoffs

- Chrome MV3 keeps one lifecycle path in the test matrix.
- Broad optional manifest patterns make arbitrary HTTPS and loopback HTTP
  origins selectable, while runtime normalization and exact-origin requests
  remain responsible for limiting each grant.
- The conservative version floors exclude older browsers that might work but
  have no packaged evidence.
- The initial Standard reference is stronger than many consumer devices, so
  support cannot yet be broadened through performance inference.
- Deterministic filtering remains available when WebGPU is unavailable, while
  local model features remain disabled.
- RSS subscriptions cannot refresh from the network until a transport can bind
  an approved address to the actual connection while preserving TLS and host
  validation.

## Consequences

- OQ-002 and the deterministic portion of OQ-012 are resolved.
- The production manifest encodes the accepted Chrome floor.
- Browser releases at or above the declared floor still run capability probes
  before mutation.
- A provider cannot use the connection path without a user gesture, quota
  acknowledgement, current origin permission and an unlocked credential when
  its adapter requires authentication.
- Worker startup rehydrates provider state through the same IndexedDB used by
  the deterministic decision service. An unreadable provider snapshot disables
  provider operations without disabling deterministic decisions.
- Model-backed device classes remain blocked by their own model, quality,
  resource and license gates.
- RSS network actions remain visibly unavailable and the worker returns a
  finite unavailable result without performing network I/O.

## Validation

Every manifest change repeats the production build, the packaged panel
smoke, provider permission and connection contracts, runtime interruption
tests and the capability benchmark. A browser floor can move only through the
deprecation contract or an active security or platform-policy exception.

Revisit this decision when a lower reference device passes every deterministic
budget or a Chrome API change invalidates one of the required probes.
