# Plugin system

## Goal

ContentLens should add platforms, classifiers and sync providers without coupling them to the decision engine.

The first releases may compile plugins into the extension. Dynamic third-party installation is deferred because it expands the security and compatibility surface.

## Plugin types

### Feed adapter

Integrates a platform page or feed source.

### Classifier

Produces topic, archetype, quality or embedding signals.

### Sync provider

Moves a versioned profile to user-selected storage.

### UI contribution

Adds settings for a built-in adapter or provider. Arbitrary content-card rendering is not exposed to third parties initially.

## Manifest

```ts
type PluginManifest = {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  kind: "feed-adapter" | "classifier" | "sync-provider";
  capabilities: string[];
  permissions: PluginPermission[];
};
```

Manifests declare capabilities and permissions before activation.

## Registration

```ts
interface PluginRegistry {
  registerAdapter(
    manifest: PluginManifest,
    adapter: FeedAdapter,
  ): void;

  registerClassifier(
    manifest: PluginManifest,
    classifier: Classifier,
  ): void;

  registerSyncProvider(
    manifest: PluginManifest,
    provider: SyncProviderFactory,
  ): void;
}
```

## Capability negotiation

The core does not assume every platform supports:

- Stable author IDs.
- Images.
- Native feedback.
- Card replacement.
- Search and passive-feed distinction.
- Thread or repost relationships.

Adapters expose capabilities. Unsupported actions are omitted from the UI.

## Isolation

- Platform selectors stay inside adapter packages.
- Provider authentication stays inside sync packages.
- Model-specific prompts and preprocessing stay inside classifier packages.
- Core packages contain no platform DOM selectors or provider endpoints.

## Third-party plugins

Before dynamic third-party plugins are supported, the project needs:

- Signed package verification.
- Permission review.
- Sandboxed execution or a constrained declarative API.
- Compatibility policy.
- Revocation and security update path.
- Rules for data access and network transmission.

Until then, "plugin" means a repository module selected at build time.

## Adapter author checklist

- Stable identity extraction is documented.
- Every surface has fixtures.
- Dynamic insertion and node recycling are tested.
- Missing metadata fails open.
- Rendering is reversible.
- Permissions are minimal.
- No profile secrets enter page context.

## Classifier author checklist

- Output uses structured core types.
- Evidence is safe to display.
- Confidence is calibrated on a declared dataset.
- Model unavailability has a fallback.
- Inputs and external data flow are documented.
- Version changes invalidate affected caches.
