# Biome lint plugins

ContentLens uses GritQL plugins for mechanical conventions that native Biome
rules do not cover. The plugins live in `biome-plugins/`, are registered in
`biome.json`, and run through `pnpm lint` and `pnpm format`.

## Catalog

| Plugin | Contract |
| --- | --- |
| `hook-conventions` | Hook return types stay inferred and consumers derive them with `ReturnType` when needed. |
| `no-classname-template-literal` | `className` does not use a template literal. |
| `no-inline-typed-event-handler` | Inline JSX handlers rely on contextual typing or move to a named handler. |
| `no-nested-render-function` | Nested `renderX` functions move into JSX or a component. |
| `no-nullable-useref-generic` | React 19 refs initialized with `null` do not repeat `null` in the generic. |
| `no-qualified-react-types` | React types use direct type imports instead of `React.X`. |
| `no-raw-process-env` | Browser extension source uses WXT's typed `import.meta.env` surface. |
| `no-reduced-motion-in-css` | Feature CSS leaves reduced-motion policy in the shared style layer. |
| `no-reduced-motion-in-js` | JavaScript leaves reduced-motion policy in the shared style layer. |
| `no-structural-ref-type` | Structural ref types use a named colocated type. |

## Project-specific scope

`process.env` remains valid in Node scripts and tests. The corresponding plugin
therefore checks only `src/**`. Reduced-motion media queries are allowed in
`src/ui/styles/globals.css` and `src/ui/styles/components.css`, the two shared
style surfaces that implement the design-system contract.

Rules tied to Next.js metadata, CSS Modules, Zustand, UUID v7 or unrelated
framework conventions are intentionally absent. In particular, replacing every
JSX ternary with `&&` would change rendering when a condition evaluates to
numeric zero.

## Suppression

Use the narrow plugin category and explain the concrete exception:

```ts
// biome-ignore lint/plugin/hook-conventions: external callback contract requires an annotation
```

Broad `lint/plugin` and `lint` suppressions hide unrelated diagnostics and
should not be used.
