# AI generation rules for ContentLens UI

These rules apply to every AI-assisted UI change, regardless of provider or
editor. The canonical design-system contract is
[ContentLens design system](README.md).

## Required flow

1. Read the feature spec and the design-system component table.
2. Search existing UI components, consumers and tests.
3. Name the required operational and view states using the closed vocabulary.
4. Compose an existing component before proposing a new one.
5. Use semantic tokens only outside the primitive token file.
6. Register every added token with layer, type, description, modes, version
   and deprecation state.
7. Add translations in `en`, `pt_BR` and `es` in the same change.
8. Add component, keyboard and edge-state tests.
9. Validate the narrow side panel, 200% zoom and reduced motion.
10. For a durable mutation, name its operation identity, replay rule, terminal
   states and reconciliation check.

## Prohibited output

- Raw color, font, spacing, radius, shadow or motion values outside primitive
  tokens.
- Linear, repeating or conic gradients, backdrop blur and glass effects.
- More than one Token-based radial glow in a view.
- Rounded navigation outside the shared `SectionNav` component.
- Repeated bordered cards that do not group a real task, metric or setting.
- A radius outside the canonical small, medium, large or round tokens.
- Serif or remote font sources, `@font-face` and CSS `font` shorthand.
- Any visible type below 12 CSS px, including relative sizing that makes a
  semantic `small` element bypass the registered type scale.
- Inline `style` props or feature-specific overrides of component internals.
- New button variants, badges or status names without a documented contract.
- A CSS token without a matching lifecycle record in `registry.ts`.
- Color-only status, icon-only action or unlabeled input.
- A recoverable error with multiple primary actions.
- A pending operation represented as an error, failure diagnostic or success.
- A retry that creates a new operation ID before the prior operation reaches a
  terminal state.
- More than one visible primary action in a view or inline confirmation.
- Initial focus on a destructive confirmation action; focus Cancel first.
- A visible native file picker whose action or empty state bypasses i18n.
- Required cloud, account or model setup in the deterministic first run.
- Icon, styling or component dependencies that are not registered in the
  dependency policy with owner, cost, license and removal conditions.
- Raw runtime styling values in injected UI outside
  `injected-primitives.ts`.

## Component decision order

Use the first matching option:

1. Existing component with existing props.
2. Existing component composed inside a layout wrapper.
3. New documented variant with tests and a real repeated use.
4. New component only for a distinct semantic interaction.

Visual preference alone does not justify a variant or component.

The accepted visual direction is Ember Gate. Generated layouts preserve one
clear reading rail, use a gate bar only for a real decision or operational
boundary, keep one primary action visible and reserve monospace text for data.
The logo geometry and approved palette remain frozen: a white frame and
decision bar, a red signal and the dark packaged-icon background.

`Surface elevation="raised"` isolates one focal group without encoding status.
`ToggleField` remains a shared component row when capabilities or content
surfaces repeat. Do not reproduce either component as an unrelated card stack.

Use `SectionNav` for peer destinations with one `aria-current="page"` value;
do not generate tab roles for ordinary settings navigation. Use `DataList` for
read-only term and value metadata. Editable values remain in labelled fields,
and operational failures remain in `Notice` or `StatePanel`.
Use `Combobox` only after proving that the eligible option count exceeds eight;
keep short, fixed lists in `SelectField`.
Use `Disclosure` only for optional detail, `SettingRow` for one setting and one
control, `SwitchField` for a true on or off setting, and `Progress` for work
that is currently advancing. Required recovery and validation stay visible.

## Prompt contract

An implementation prompt should name:

- the accepted requirement IDs;
- the view and operational states;
- the existing components to reuse;
- the allowed files;
- the required i18n keys;
- the keyboard, zoom and browser checks;
- a screenshot viewport and expected primary action count.

If any of these are unknown, inspect the code and product contracts before generating UI.

## Validation

Run:

```bash
pnpm design-system:check
pnpm test:unit
pnpm test:a11y
pnpm typecheck
pnpm build:chrome
pnpm build:firefox
pnpm test:browser v01
```

Screenshots supplement these gates. They do not replace semantic markup,
keyboard operation or packaged browser tests.
