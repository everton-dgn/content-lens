# ContentLens design system

Version: 0.5.0

The ContentLens design system makes extension-owned UI predictable across the
side panel, injected controls and future optional capabilities. Its visual
language is Ember Gate: dark charcoal workspaces, red action signals, compact
rounded surfaces and one illuminated focal point keep local decisions legible
without turning operational state into decoration.

## Ember Gate visual grammar

Ember Gate combines the ContentLens mark with a dark-first side-panel structure.
Rounded cards group related work, quiet
shadows separate transient layers, and the three-pixel gate bar identifies a
real decision boundary. One token-based radial glow may reinforce the focal
metric or primary action. Other surfaces stay solid.

The primary experience uses charcoal canvas, layered graphite surfaces, warm
white text and action red. Light mode preserves the same hierarchy on quiet
blue-gray surfaces. Red is reserved for the current destination, a direct
action or an active rule boundary. Ready remains teal, while degraded and
error remain amber. URLs, hosts, model identifiers and numeric evidence use
the system monospace stack; ordinary product copy uses the native sans-serif UI
stack.

The type scale starts at 12 CSS px. Uppercase metadata uses the subtle neutral
text token, semibold weight and restrained tracking so it remains distinct from
the regular-weight value below it. Red text remains reserved for the current
destination, direct actions and active rule boundaries.

Version 0.5.0 introduces Ember Gate and the shadcn composition layer. Radix
primitives own keyboard and focus behavior, Lucide supplies consistent action
icons, Tailwind v4 exposes the semantic token contract, and the existing
ContentLens components remain the public UI API. The browser-native i18n
runtime remains in place because it is the platform boundary for Chrome and
Firefox.

## Sources and principles

The token architecture follows the stable
[Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/2025.10/format/)
model of named values, aliases and groups. Component guidance follows the
separation used by [Carbon](https://carbondesignsystem.com/designing/get-started/):
foundations define the visual language, components define reusable controls and
patterns define when those controls should be composed.

The system has four rules:

1. A visual value has one canonical token.
2. A repeated interaction has one canonical component.
3. A user-visible state has one label, shape and semantic tone.
4. A recoverable failure exposes no more than one primary recovery action.

Tailwind v4 maps the semantic CSS tokens, Radix supplies interaction primitives,
and the shared component layer follows shadcn composition conventions. Browser
message catalogs remain the translation boundary for extension pages.

## Architecture

| Layer | Location | Responsibility |
| --- | --- | --- |
| Primitive tokens | `src/ui/styles/tokens/primitives.css` and synchronized `injected-primitives.ts` | Raw palette, type, spacing, radius, size, shadow and motion values |
| Semantic tokens | `src/ui/styles/tokens/semantic.css` | Meaning such as canvas, action, focus, ready and error |
| Token registry | `src/ui/styles/tokens/registry.ts` | Machine-readable name, layer, type, description, modes, version and deprecation state for every CSS token |
| State contract | `src/ui/styles/tokens/contract.ts` | Version and closed state vocabularies shared by TypeScript |
| Components | `src/ui/components/` and `src/ui/styles/components.css` | Accessible markup and token-only visual rules |
| Feature composition | `src/entrypoints/sidepanel/` and `src/ui/*/` | Product flows made only from system components and tokens |

Primitive tokens may contain raw values. The runtime primitive subset exists
only because injected Shadow DOM styles cannot consume extension-page custom
properties; the guard requires every runtime value to exist in
`primitives.css`. All other UI styles must consume semantic, component or
synchronized runtime tokens.

Version 0.5.0 made dark mode the first-paint default, promoted the radius and
elevation primitives into the Ember Gate card hierarchy, and mapped semantic
tokens into Tailwind v4. No domain state or persistence contract changed.

The token registry is a conformance boundary. Every token declared in
`primitives.css` or `semantic.css` must have exactly one metadata record. The
design-system guard rejects missing, stale or duplicate records and requires
the registry version to match `contract.ts`. New tokens start with
`deprecated: false`; replacement metadata must name the version and canonical
replacement before a token can be retired.

## Token naming

Names use the `--cl-` prefix and move from source to meaning:

```text
--cl-color-ink-950      primitive
        ↓
--cl-color-action       semantic alias
        ↓
.cl-button primary      component use
```

Do not name tokens after a page, feature or temporary visual appearance.
`--cl-color-rule-editor-blue` is invalid. `--cl-color-action` remains valid
when a future theme changes its underlying hue.

## State vocabulary

Operational status is limited to `ready`, `loading`, `degraded`, `offline` and
`error`. View state is limited to `empty`, `loading`, `offline`, `degraded`,
`success` and `error`.

| State | Meaning | Semantic token | Required non-color cue |
| --- | --- | --- | --- |
| Ready | Baseline capabilities are available | `--cl-color-ready` | Check mark and visible label |
| Loading | A bounded operation is pending | `--cl-color-loading` | Rotating arrow or static arrow under reduced motion |
| Degraded | Baseline works with a known limitation | `--cl-color-degraded` | Exclamation mark and explanation |
| Offline | Network-backed optional work is unavailable | `--cl-color-offline` | Open circle and local fallback text |
| Error | The current operation failed | `--cl-color-error` | Cross mark, problem and one safe recovery action |

Degraded and error resolve to the same block signal because the palette
declares one alert hue. They are never confusable in use: degraded shows an
exclamation mark with the surviving capability, error shows a cross mark with
the failed operation and one safe recovery action. State always uses text and
shape in addition to color, so a hue never carries a state alone.

Features must not introduce synonyms such as `limited`, `unavailable` or
`broken` as visual states. Domain services may retain their precise internal
states, but adapters must map them to this vocabulary before rendering.

`Notice` and `Badge` draw their tones from the same closed vocabulary:
`info`, `success`, `degraded` and `error` for `Notice`, and `info`, `success`
and `degraded` for `Badge`. Their types derive from `ViewState`, so a tone
cannot drift from the contract.

Two component properties carry no operational meaning and sit outside the state
vocabulary: `Badge tone="neutral"` for a plain property, and
`Surface tone="subtle"` for the nonauthoritative preview sample. The
design-system guard rejects every other literal in a `tone`, `state` or
`status` attribute.

## Components

| Component | Use when | Do not use when |
| --- | --- | --- |
| `SidepanelShell` | Rendering an extension-owned side panel view with an optional fixed navigation region | Rendering an injected card control or nested section |
| `StatusRail` | Showing the current operational capability of the panel | Reporting a one-off form validation error |
| `StatePanel` | Showing empty, pending, degraded, offline, success or error views | Laying out a normal list or form |
| `Button` | Triggering a user action | Navigating to explanatory text without an action |
| `BackAction` | Returning to the owning view with a compact, leading-arrow action | Styling a feature-specific back button or representing browser history |
| `Surface` | Grouping content with a shared purpose; `raised` may isolate the one focal group without implying status | Adding decoration around unrelated content or using elevation as a status signal |
| `Badge` | Showing a short stable property such as local or verified | Displaying a sentence, error or changing progress |
| `Field` | Collecting one short text value with label and help | Collecting structured multi-value input |
| `SelectField` | Choosing one provider, model, route or other value from a known list | Choosing several values or hiding unavailable options |
| `Combobox` | Choosing one value from more than eight searchable options | Replacing a short select or accepting a free-form value |
| `SecretField` | Entering a new write-only credential or passphrase with transient reveal | Displaying or recovering a previously saved secret |
| `FileField` | Selecting one local file with product-owned labels and status | Collecting short text or accepting several files |
| `ChoiceGroup` | Choosing one value from two to four mutually exclusive options | Selecting several values or hiding an advanced setting |
| `ToggleField` | Enabling one capability, surface or reviewed consent as a hairline row | Choosing exactly one value from a small mutually exclusive set or creating a stack of bordered cards |
| `SectionNav` | Moving between peer sections while preserving one visible current destination | Triggering an operation or representing nested data as tabs |
| `DataList` | Showing stable term and value metadata such as model capabilities and verification | Building an editable form, action list or status alert |
| `Dialog` | Reviewing a consequential action with explicit confirm and cancel controls | Showing ordinary form content or replacing a full-view error |
| `Disclosure` | Hiding optional advanced detail behind one native summary control | Hiding required controls, errors or the current effective value |
| `Progress` | Reporting bounded or indeterminate work with a visible label | Representing an operational status after work has finished |
| `SettingRow` | Pairing one concise setting description with one control or value | Grouping several unrelated controls or long form content |
| `SwitchField` | Editing one explicit on or off setting whose state is announced as a switch | Choosing among several values or collecting independent consent |
| `Notice` | Explaining one contextual status inside a flow | Replacing `StatePanel` for a full-view failure |
| `Brand` | Rendering the approved mark by itself or with the ContentLens name | Replacing a platform icon, status symbol or action icon |

`StatePanel` accepts one `primaryAction` slot. Secondary and advanced actions
belong in the feature flow after progressive disclosure. Components never
accept inline `style`. A shared component may accept `className` for documented
layout composition, while feature code must not override component internals.

A view exposes at most one visible primary action. An inline confirmation may
temporarily replace that action with its confirm button, but unrelated actions
remain secondary. A destructive confirmation initially focuses Cancel and
returns focus to its review trigger when closed. Native file-input chrome is
not product UI; use `FileField` so the action, empty state and selected-file
status stay localized.

`SectionNav` renders native buttons inside a labelled navigation landmark. The
active destination uses `aria-current="page"`; tab semantics and arrow-key-only
navigation do not apply because every destination remains an ordinary action.
The `compact` variant presents dense side-panel destinations in a two-column
grid with white inactive tiles on the light canvas, while `tabs` remains the
horizontal option-page treatment. Labels wrap inside their destination at 320
CSS px. `DataList` keeps source order, uses
one `dl` with paired `dt` and `dd` elements. Its default grid changes from one
to two columns only at the canonical `24rem` breakpoint. IDs and versions may
use an inner `code` element; ordinary descriptions retain the UI font. Use
`layout="summary"` when an overview needs a stronger scan order. This layout
keeps each label above its full-width value in one column.

`Combobox` pairs a labelled Radix popover and search input with a synchronized
native select contract. Search filters labels case-insensitively while retaining
the current selection. Tab, arrow keys, Home, End and type-ahead keep their
expected browser behavior. Use it only when the complete eligible list has more
than eight values; shorter lists stay in `SelectField`.

`Dialog` uses the Radix dialog primitive, a labelled landmark and initial focus
on Cancel. Closing returns focus to the action that opened it. Confirmation
uses the one visible primary or danger action; unrelated primary actions stay
hidden while the dialog is open.

`Disclosure` uses the Radix collapsible primitive and retains a synchronized
native details contract for stable browser and test behavior. Its trigger names
the hidden content. Required recovery, validation and effective settings remain
outside it. `SettingRow` keeps one description next to one canonical control
and stacks naturally when text grows.

`SwitchField` and `ToggleField` use Radix interaction primitives with
synchronized native controls for form compatibility. Space changes state, Tab
moves focus and the label remains the click target. `Progress` always has a
visible programmatic label. Omit `value` only for an indeterminate operation and
provide a separate visible value label when a number alone would be ambiguous.

Pending durable mutations use an informational `Notice`, retain the reviewed
input and expose one action that checks the same operation again. That action
must reuse the complete operation command, including `operationId`, timestamp,
expected revision and payload. A pending response is not an error, does not
create a failure diagnostic and does not release the operation identity.
Committed results release the identity only after the current profile has been
reconciled. Terminal failed, cancelled, compensated, partial and unavailable
results may release it for the documented next action.

`Surface tone="subtle"` is reserved for a nonauthoritative preview sample. It
must not encode recovery, warning or selection state.

## Layout rules

- Start with the narrow side panel. The horizontal status rail is the default;
  the vertical rail activates only above `24rem` and remains compact.
- Use rounded surfaces for purposeful groups and hairline dividers inside a
  dense group. Elevation separates a focal card, menu or dialog without
  encoding status. Repeated toggles stay inside one shared component group.
- Use `--cl-space-4` as the outer padding for `Surface` and `StatePanel`.
  Dense repeated rows may use `--cl-space-3` with hairline dividers. Do not
  nest another card only to create spacing.
- A subpage starts its `BackAction` `--cl-space-3` below the product header and
  leaves `--cl-space-5` before the page heading. The 44-pixel action target
  remains intact while the return action stays visually attached to the top.
- Use the gate bar for a decision, state or protected boundary. Do not add it as
  decoration to a container that has no verdict or operational meaning.
- Use the canonical small, medium and large radii. Circular status dots,
  avatars and switch thumbs use the round token.
- Rounded navigation uses one compact container. The active destination gets a
  red icon, label and quiet red surface, with `aria-current="page"`.
- Preserve one reading column and a logical heading order.
- Keep the status marker, beam and label adjacent in both rail orientations.
- Use the spacing scale. Do not create fractional gaps for visual tuning.
- Keep every direct control at least `2.75rem` high.
- Do not use fixed content heights. Text must reflow at 200% zoom.
- Use only `--cl-font-ui` for operational text. CSS `font` shorthand,
  `@font-face`, remote font imports and a serif UI primitive are rejected by
  the design-system guard.
- A token-based radial glow is allowed once in the focal region. Linear,
  repeating or conic gradients and glass effects are prohibited. Use the
  semantic raised shadow for focal surfaces and active tabs. Use the overlay
  shadow for menus, dialogs and primary navigation.

## Accessibility rules

- Meet WCAG 2.2 AA for extension-owned UI.
- `CL-UI-001`: Visible extension-owned text MUST render at 12 CSS px or larger,
  including badges, metadata, navigation labels, helper copy and semantic
  `small` elements.
- State always uses text and shape in addition to color.
- Every input has a programmatic label and linked hint or error.
- Error views use `role="alert"`; bounded progress uses `role="status"` and
  `aria-busy`.
- Focus indicators use the system focus token and remain visible in forced
  colors.
- Motion is optional. Reduced motion leaves a static state cue.
- Keyboard, 200% zoom, reduced motion and forced colors are release checks.

## Contribution flow

1. Read this document and [AI generation rules](ai-generation.md).
2. Search `src/ui/components/` before creating a component.
3. Add or change primitive values only when no semantic alias can express the
   requirement.
4. Add or update the token metadata record in `registry.ts`.
5. Document the component's use and antiuse in this table.
6. Add component, accessibility and narrow-layout tests.
7. Run `pnpm design-system:check`, `pnpm test:unit`, `pnpm test:a11y` and
   `pnpm test:visual`. The visual lane compares the packaged panel against
   per-platform baselines and runs on every push and pull request. When a
   change to the visual contract is intended, regenerate the macOS set with
   `--update-snapshots` and the Linux set with the Visual baselines workflow,
   and commit both.
8. Run the packaged Chrome and Firefox journeys before release.

The public CI runs the same design-system guard through `pnpm ci:local`.

The approved Convergent control geometry lives in `src/ui/brand/mark.ts`.
`Brand`, the lockup and every PNG under `public/icon/` derive from that 32 by 32
source. Use the mark at 16, 20, 24, 32, 48, 64 or 128 CSS px. Preserve its
aspect ratio, shape order and clear space. Do not rotate it, recolor individual
signals, place copy inside the frame or use it as a status/action glyph.

`mark.ts` is the runtime source for component lockups and packaged icons. Run
`pnpm brand:icons` after an approved palette or geometry change. The public
guard runs `pnpm brand:icons:check` to reject stale generated PNGs.
