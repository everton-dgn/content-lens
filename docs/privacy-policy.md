# ContentLens privacy policy

Last reviewed: 2026-08-12

This is the store-facing statement. It describes what the extension actually
does, verified against the code and the tests named at the end. The engineering
detail behind it lives in [privacy and security](10-privacy.md), the
[threat model](threat-model.md) and the
[permissions matrix](security/permissions-matrix.md).

## The short version

ContentLens has no account, no backend and no telemetry. Everything it needs to
work lives in your browser profile. It makes no network request until you
configure something that needs one, and then only to the exact address you
chose.

## What we collect

Nothing. There is no analytics, no crash reporting, no usage measurement and no
identifier that follows you. No data reaches the authors of this extension by
any path.

Firefox installs declare this as `data_collection_permissions.required:
["none"]`.

## What the extension stores, and where

Everything below stays in the extension's own storage inside your browser
profile. None of it is uploaded anywhere by default.

| Data | Why it exists | Removal |
| --- | --- | --- |
| Your rules | Decide what to hide, allow, reduce or promote | Delete a rule, or reset local data |
| Your explicit feedback | Correct a wrong decision | Reset local data |
| Settings | Platforms, surfaces, interface and routing preferences | Reset local data |
| Local diagnostics | Show why something failed and offer recovery | Clear diagnostics, or wait for the seven-day retention limit |
| Recovery snapshots | Undo a failed import or migration without losing rules | Reset local data |
| Derived indexes for optional capabilities | Similarity and content-graph features when enabled | Disable the capability, or reset local data |

Diagnostics record stable failure codes and bounded counts. They exclude page
content, URLs, account identifiers and the values inside your rules.

Uninstalling the extension removes this storage with the extension.

## When the extension uses the network

Network features stay off until you configure them. The available paths are:

**A model provider you configure.** You choose the provider and its exact
address, you approve the browser permission for that origin, and you record a
consent receipt per capability. Requests then go only to that origin. If you
never configure one, no request is ever made and the deterministic rules keep
working.

**User-owned synchronization you configure.** The extension exchanges a
portable profile with the exact endpoint you chose. Local data remains usable
when that endpoint is offline.

**Reviewed feedback to a platform**, when you enable it and confirm each
action. The extension never submits anything on its own.

Platform pages themselves are read in place, in an isolated content script, on
the platforms you enabled. Nothing from them is transmitted.

RSS and Atom subscriptions can remain in a portable profile, and local feed
documents can still be parsed. Network acquisition is disabled in every
supported browser. A browser request by hostname cannot be bound to the IP
address approved by a separate DNS check, which would leave a DNS-rebinding
path to private networks.

## Credentials

A provider credential is write-only from the interface. It is stored separately
from your profile, encrypted, and never appears in an export, a diagnostic
record, a log or a release artifact. Choosing `session-only` keeps it in memory
for the session and never writes it to disk.

## What leaves your device if you use an optional capability

Only what that capability needs, only to the provider you chose:

- Text classification sends the item text under a byte limit, with fixed
  instructions separated from the content.
- Visual classification sends one image, re-encoded without metadata, after you
  consent to image sending specifically.
- Rule assistance sends your stated intent and examples.

Each is disabled by default. Removing every optional capability leaves the
deterministic path unchanged.

## Sharing

Nothing is shared, sold or transferred. There is no third party in the data
path other than the provider you chose and configured yourself.

## Your control

- Export your profile at any time, as plain JSON or an encrypted file.
- Import it into another browser.
- Clear diagnostics, or reset all local data, both behind an explicit
  confirmation.
- Disable any platform or capability; the extension stops touching it.

## Children

ContentLens is not directed at children and collects nothing from anyone.

## Changes

A change to this policy ships with a release and appears in the
[changelog](../CHANGELOG.md). The reviewed date at the top is the version in
force.

## Contact

Report a privacy concern through the process in the
[security policy](../SECURITY.md).

## How to verify these claims

Every statement above is enforced by a test:

| Claim | Evidence |
| --- | --- |
| Credentials never reach an export or diagnostics | [`tests/security/portable-profile-secrets.test.ts`](../tests/security/portable-profile-secrets.test.ts), [`provider-credentials.test.ts`](../tests/security/provider-credentials.test.ts) |
| A provider request goes only to its declared origin | [`tests/security/provider-request-boundary.test.ts`](../tests/security/provider-request-boundary.test.ts) |
| RSS network acquisition remains disabled | [`tests/contract/rss-service-worker-runtime.test.ts`](../tests/contract/rss-service-worker-runtime.test.ts), [`tests/ui/feed-panel.test.tsx`](../tests/ui/feed-panel.test.tsx) |
| Page content is not transmitted | [`tests/security/messages.test.ts`](../tests/security/messages.test.ts), [`text-classification.test.ts`](../tests/security/text-classification.test.ts) |
| Images are minimized before sending | [`tests/security/visual-input.test.ts`](../tests/security/visual-input.test.ts) |
| Native feedback stays inside its boundary | [`tests/security/native-feedback-boundary.test.ts`](../tests/security/native-feedback-boundary.test.ts) |
| No host is granted at install time | [`src/config/manifest.test.ts`](../src/config/manifest.test.ts), [permissions matrix](security/permissions-matrix.md) |
| Export and import round-trip without loss | [`tests/sync/import-export-service.test.ts`](../tests/sync/import-export-service.test.ts) |

The extension is open source. The exact bytes of every release are reproducible
from the tagged source, with checksums, an SBOM and build provenance published
alongside them.
