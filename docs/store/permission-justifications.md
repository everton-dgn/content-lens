# Store permission justifications

Both stores ask why each permission is needed. These answers are written from
the packaged manifests in `src/config/manifest.ts` and the
[permissions matrix](../security/permissions-matrix.md), which is the
engineering source. Keep the two in step: a manifest change without a change
here is a review failure waiting to happen.

## Chrome Web Store

| Item | Justification to submit |
| --- | --- |
| `sidePanel` | ContentLens presents all of its own interface in the side panel: rules, review queue and settings. The permission opens that panel from the toolbar action. It grants no page access. |
| `scripting` | The extension registers one isolated content script per platform you enable, and only after you grant that platform's host. It is what lets a hidden item show a reversible placeholder in place. It grants no host by itself. |
| `alarms` | User-owned synchronization uses one bounded background schedule instead of a live timer, so a suspended service worker can resume safely. The schedule exists only after the user configures a synchronization endpoint. |
| `optional_host_permissions: https://*/*` and `http://*/*` | Not granted at install. The user picks a model provider, synchronization endpoint or platform and the browser grants only the requested origin. The wildcard only declares which optional origins may be requested later; runtime validation rejects paths, queries, fragments, user information, wildcards and remote plaintext HTTP. Loopback HTTP is allowed for a local service. |
| Remote code | None. No script is fetched or evaluated at runtime. Everything shipped is in the package. |
| Data collection | None by default. The extension has no account, no backend and no telemetry. Network access happens only for a platform, provider, synchronization endpoint or reviewed feedback action the user enabled. RSS and Atom network acquisition is disabled. |

Static `content_scripts` are empty in the packaged production manifests, so
nothing runs on any site until the user enables that platform.

## addons.mozilla.org

| Item | Justification to submit |
| --- | --- |
| `scripting` | Same as Chrome: one isolated content script per enabled platform, registered after its host is granted. |
| `alarms` | Same as Chrome: bounded background scheduling for user-owned synchronization. |
| `optional_permissions: https://*/*` and `http://*/*` | The MV2 equivalent of the Chrome optional hosts, requested one exact origin at a time after a named user gesture. The manifest does not request `dns`; RSS and Atom network acquisition is disabled. |
| `data_collection_permissions.required: ["none"]` | The deterministic baseline collects nothing. |
| `data_collection_permissions.optional: ["authenticationInfo", "websiteContent"]` | Declared because a user-configured provider may receive an API credential and the content the user asked to classify. Both stay absent until the user configures a provider and records a consent receipt per capability. |

### Source-code review notes

Firefox reviewers receive a source archive alongside the package. The build is
reproducible with the steps in [SOURCE_CODE_REVIEW.md](../../SOURCE_CODE_REVIEW.md):
`pnpm install --frozen-lockfile` then `pnpm exec wxt zip -b firefox`. No
minifier configuration, obfuscator, remote module or post-build patch is used,
and the build performs no network access after the locked install.

## Privacy disclosure

Both stores link to [the privacy policy](../privacy-policy.md). Its claims are
each backed by a named test, listed at the end of that document, so a reviewer
can check rather than take the statement on trust.

## Before submitting

- Rebuild both packages and confirm the manifests match this file.
- Confirm `pnpm ci:local` and the packaged browser journeys pass.
- Confirm the stable release package carries checksums, an SBOM and provenance.
