# Extension permissions matrix

This matrix covers the accepted deterministic production baseline from
[ADR 0014](../adr/0014-browser-manifest-permissions.md).

## Production manifest inputs

| Permission or host boundary | Browser | Requirement ID | Capability | Requested when | Fallback or failure behavior |
| --- | --- | --- | --- | --- | --- |
| `sidePanel` | Chrome/Chromium 149 or newer | FND-009, SEC-001, CAP-001 | Display the extension-owned side panel and open it from the toolbar action. | Declared at installation because WXT emits the side-panel entrypoint. | Mark the panel surface unsupported, perform no platform-content mutation and show the supported-browser requirement. |
| `scripting` | Chrome/Chromium | PCS-009, MAP-056, MAP-058 | Register one isolated content script for an enabled platform after its exact host permission is present. | Declared at installation. Runtime registration starts only after settings and permission reconciliation. | Unregister the platform script, restore connected candidates and leave all platform content visible. |
| `alarms` | Chrome/Chromium | SYN-005, SYN-013 | Resume user-owned synchronization on a bounded schedule when a service worker is suspended. | Declared at installation. No synchronization request is authorized until the user configures and enables an endpoint. | Local data remains available and synchronization reports its current unavailable or failure state. |
| Empty production `content_scripts` | Chrome/Chromium | PCS-009, MAP-056, MAP-058 | Prevent install-time access to every supported social platform. | Static registration stays empty in packaged production manifests. | A platform remains disabled until the user grants its exact optional host. |
| `optional_host_permissions: ["https://*/*", "http://*/*"]` | Chrome/Chromium | PRV-009, PRV-017, SET-013 | Make custom HTTPS providers and loopback HTTP providers selectable without granting them at install time. | `permissions.request` receives one normalized origin pattern inside the named user gesture. Runtime endpoint validation rejects remote HTTP, paths, queries, fragments, userinfo and wildcards. | The provider remains locked and the deterministic local baseline continues. |
| RSS network acquisition disabled | Chrome/Chromium | HRA-014, HRA-015, PCS-003 | Prevent hostname validation from being separated from the browser connection it was intended to approve. | The feed interface exposes stored subscriptions but disables network actions. The worker returns `dns-api-unavailable` without calling `fetch`. | Local parsing, stored subscription state, portable profiles and other adapters remain available. |

## Excluded permissions

The production manifests request no `tabs`, `activeTab`, `storage`, history,
cookies, downloads, notifications, clipboard, required platform or provider
hosts or remote code capability. `scripting` grants registration capability but
does not grant a host by itself. WXT may add development-only permissions for
hot reload; those permissions must not appear in packaged production manifests.

Provider descriptors, model descriptors, consent receipts and encrypted
credential envelopes use extension-owned IndexedDB, which requires no manifest
permission. This local persistence does not authorize a network request.
Provider host access is optional and absent until the browser grants the exact
origin selected by the user. `session-only` uses privileged memory and does not
add a `storage` permission.

The connection test rechecks permission before credential use. It uses a
packaged synthetic classification payload, validates the adapter response
schema and stores only its finite result code, outcome, latency and timestamp.
Production inference keeps its separate `ready` status check and still requires
an exact consent receipt plus an eligible route.

The panel adapter treats an absent or throwing API as unsupported. Chrome calls
`sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`. It does not
request permission repeatedly or fall back to page-context code.

## Verification

The foundation gate builds the production artifact and runs the checks
below. Contract tests live in `tests/contract` and run as part of
`pnpm test:unit`.

```text
pnpm build:chrome
pnpm test:unit
pnpm exec playwright test tests/browser/panel-open-smoke.spec.ts
```

The Playwright smoke loads the packaged Chrome MV3 extension in Chromium,
verifies that the real Side Panel API accepts action-click behavior and renders
`sidepanel.html`. Other packaged runs execute content and background contexts,
reload the extension context and verify replay plus capability probes.

The provider contract lane verifies:

- exact origin checks before vault access;
- explicit gesture and quota acknowledgement;
- synthetic payload and strict provider schema;
- finite redacted results for success, authentication, authorization, TLS,
  host, rate limit, quota, model access, schema, protocol, timeout, offline and
  cancellation;
- transactional persistence that does not modify live state after a failed
  write;
- worker rehydration that degrades only provider operations on unreadable
  state.
