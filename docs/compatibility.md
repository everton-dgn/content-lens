# Compatibility and versioning

## Version domains

ContentLens separates:

- Product version.
- Profile schema version.
- Adapter contract version.
- Plugin API version.
- Classifier and model version.
- Archetype-definition version.

One domain changing does not automatically increment every other domain.

## Product version

Public releases follow [RELEASES.md](../RELEASES.md).

## Development toolchain baseline

[ADR 0013](adr/0013-extension-toolchain-layout.md) selects the standalone
extension toolchain. `package.json` currently requires:

| Component | Selected line | Probe version |
| --- | --- | --- |
| Node.js | 24.x | 24.18.0 |
| pnpm | 11.x | 11.17.0 |
| React and React DOM | 19.x | 19.2.8 |
| TypeScript | 7.x | 7.0.2 |
| Vite | 8.x | 8.1.5 |
| WXT | 0.21.x | 0.21.1 |
| `@wxt-dev/module-react` | 1.x | 1.2.2 |

The manifest and lockfile own the exact versions. A version update repeats the
clean frozen install, strict typecheck and packaged Chrome and Firefox builds.
Toolchain versions do not establish browser support; the browser table is
governed by ADR 0014 and packaged capability tests.

## Profile schema

Profiles contain `schemaVersion: { major, minor }`, where both values are non-negative integers.

Rules:

- Readers MUST reject an unsupported newer major schema without mutating local data.
- Readers MAY accept a newer minor schema only when unknown fields can be safely preserved or ignored.
- Readers MAY preserve unknown fields when their type and size are safe.
- A migration MUST create a validated local snapshot before mutation.
- A failed migration MUST leave the prior profile readable.
- Downgrade behavior MUST be documented per schema change.
- Export MUST use the stable profile schema, not raw database records.

## Contract compatibility

A change is breaking when it:

- Removes or renames a required field.
- Changes field meaning or valid range.
- Alters rule precedence.
- Changes default user-visible action.
- Broadens synchronized data.
- Adds a required permission.
- Makes previously local data remote.

Breaking changes require an ADR, migration plan and version increment for the affected domain.

## Adapter compatibility

Adapters declare:

- Contract version.
- Platform and tested page variants.
- Supported surfaces.
- Extractable identities and fields.
- Render and action capabilities.
- Last live smoke-test date.

An adapter can be disabled independently when platform changes break its safety contract.

## Browser compatibility

The deterministic browser baseline comes from
[ADR 0014](adr/0014-browser-manifest-permissions.md). The packaged manifests
declare these minimums:

| Browser | Minimum version | Manifest | Capability level | Status |
| --- | --- | --- | --- | --- |
| Chrome/Chromium | 149 | MV3 | Deterministic baseline | Supported |
| Firefox Desktop | 151.0 | MV2 | Deterministic baseline | Supported with optional-capability fallback |

Earlier versions are unsupported because the project does not run equivalent
packaged checks against them.

Support has two dimensions:

- A browser-version floor backed by automated and live evidence.
- A runtime capability level detected on the current device and profile.

A supported browser can expose only the deterministic baseline when optional model, graphics or extension APIs are unavailable. Capability detection runs before showing an action that depends on that capability and is refreshed after a browser update, an extension update, or a material device change.

Compatibility states are:

| State | Required behavior |
| --- | --- |
| Supported | Enable the tested capability set |
| Supported with fallback | Enable deterministic behavior and explain unavailable optional capabilities |
| Temporarily degraded | Preserve local operation, expose recovery and retry capability detection later |
| Unsupported | Avoid partial mutation, explain the minimum requirement and provide export access when readable |

Unknown browser or platform variants fail open. They do not inherit support from a matching user-agent string without contract evidence.

### Automated coverage and limitations

The stable browser claim covers synthetic YouTube Home, search and related
fixtures, the extension-owned panel manifest and adapter contract, reversible
card rendering, runtime messaging, IndexedDB, worker interruption and
deterministic behavior. Fixture provenance is recorded in
[YouTube fixtures](datasets/youtube-fixtures.md).

WebGPU and every model-backed feature remain optional. A missing optional
capability reports a degraded or unavailable state while deterministic
filtering remains available.

No support claim covers store-signed packages, Firefox MV3, mobile browsers,
enterprise-policy environments, mobile browsers or authenticated platform
variants that are absent from the packaged journeys.

The Chrome journey loads the production MV3 package and opens its real
extension-owned side panel. The Firefox journey installs the production MV2
package and exercises its built panel bundle through the repository harness.
Native Firefox sidebar operation remains a manual release check.

Current automated evidence lives in executable checks rather than committed
reports:

```text
pnpm test:unit
pnpm test:a11y
pnpm test:browser
pnpm test:browser:packaged
pnpm test:runtime
pnpm benchmark
```

## Deprecation

Deprecation notices include replacement, affected version domains, migration instructions and planned removal. Security or platform-policy violations may require immediate removal.
