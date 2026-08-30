# Store permission justifications

The store asks why each permission is needed. These answers are written from
the packaged manifests in `src/config/manifest.ts` and the
[permissions matrix](../security/permissions-matrix.md), which is the
engineering source. Keep them in step: a manifest change without a change
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

## Privacy disclosure

The store links to [the privacy policy](../privacy-policy.md). Its claims are
each backed by a named test, listed at the end of that document, so a reviewer
can check rather than take the statement on trust.

## Before submitting

- Download the exact stable GitHub Release assets and submit only those
  packages. Do not run `wxt build` or `wxt zip` during publication.
- Use a local rebuild only as an independent comparison and confirm its
  manifests match this file.
- Confirm `pnpm ci:local` and the packaged browser journeys pass.
- Confirm the stable release package carries checksums, an SBOM and provenance.
