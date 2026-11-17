# Functional CSS classes

An opt-in methodology for Tailwind v4 projects, enforced by eleven native lint rules. Markup carries
one class per element, and that class names what the element does: `submit-button`, `user-card`,
`order-status`. Everything visual is composed below it in floors, and each floor may use only the
floor directly under it. The rules check every floor in one pass and keep Tailwind utilities and
lower floors out of markup.

## Colours: three floors

| Floor | Lives in | Name | Uses |
|---|---|---|---|
| Palette | a theme selector block (`:root`, `[data-theme]`), not `@theme` | `--palette-<hue>[-<step>]` | literal colours |
| Role | `@theme`, overridden in theme selector blocks | `--color-<family>-<slot>[-<state>]`, `--color-surface-<level>` | `var(--palette-…)` |
| Tone | `@utility tone-…` | `tone-<family>-<delivery>`, `tone-surface-<level>` | colour Bricks on Roles |

- **Palette** holds raw values. Outside `@theme`, Tailwind generates no utilities for it.
- **Role** says what a colour is for. Themes switch only here, by overriding Roles in a theme
  selector block. `@theme` resets the stock palette with `--color-*: initial`, so `bg-blue-600`
  does not exist.
- **Tone** is the colour class a component applies: background, text, border and their states,
  all from one family. The delivery decides which slots it paints with.

Default closed lists (each can be replaced in the config):

- families: `neutral`, `accent`, `danger`, `success`, `warning`;
- slots: `fill`, `on-fill`, `wash`, `ink`, `ink-subtle`, `edge`;
- states: `hover`, `active`;
- deliveries: `solid` (`fill`, `on-fill`), `soft` (`wash`, `ink`), `outline` (`edge`, `ink`),
  `plain` (`ink`), `subtle` (`ink-subtle`);
- surface levels: `page`, `raised`, `sunken`, `overlay`. A surface Tone paints its level and adds
  `neutral` ink, ink-subtle and edges.

A family Tone may also paint the focus ring with its family's `edge` slot under a focus variant
(`focus-visible:outline-accent-edge`), whatever its delivery. A Role with a state is applied under
that state's variant (`hover:bg-accent-fill-hover`). The `dark:` variant is not allowed anywhere.

## Components: four floors

| Floor | Lives in | Name | Uses |
|---|---|---|---|
| Brick | Tailwind | `px-4`, `rounded-md`, … | — |
| Trait | `@utility <kind>-<name>` | `shape-control`, `type-label`, `layout-row`, `focus-ring`, `motion-press` | non-colour Bricks setting the properties its kind owns |
| Pattern | `@utility pattern-<element>` | `pattern-button`, `pattern-card` | Traits |
| Function | `@layer components` | `<purpose>-<element>`, at least two words | at most one Pattern, any Traits, exactly one Tone |

- Each trait kind owns a disjoint set of CSS properties, so the order Traits are applied in never
  decides a conflict. Default kinds: `shape` (size, padding, margin, radius, border width and style,
  background geometry), `type` (font, line height, spacing, alignment, decoration, wrapping),
  `layout` (display, flex, grid, gap, alignment, position, overflow), `motion` (transition,
  animation, transform), `focus` (outline width/offset/style, ring width), `effect` (opacity,
  shadows, filters, blend modes), `behavior` (cursor, pointer events, selection, touch, scroll).
- A Brick that sets properties of several kinds (`truncate`) is spelled out as Bricks that each
  set one kind's properties.
- A Trait may also hold declarations of its kind's properties; never a colour.
- A Function's first word is not a floor word (`shape`, `type`, `layout`, `motion`, `focus`,
  `effect`, `behavior`, `pattern`, `tone`, `palette`, `color`).
- A Function's selector is one class, optionally with one attribute: `.order-status`,
  `.order-status[data-status="paid"]`, or nested `&[data-status="paid"]`. A state block swaps the
  Tone and nothing else. Interaction states belong to the Tone's variants.
- Functions hold no declarations and no variants. There are no "parts": every element gets its own
  Function (`user-name`, not `user-card-title`).

## Markup

<!-- example:file examples/api/lint/FunctionalClasses.tsx#doc -->
```tsx
interface IActionProps {
    danger: boolean;
    status: 'paid' | 'open';
}

export const Action = ({danger, status}: IActionProps) => (
    <div className="order-status" data-status={status}>
        <button className="submit-button">Save</button>
        <button className={danger ? 'delete-button' : 'submit-button'}>Go</button>
    </div>
);
```

`className` is one Function written as a string literal, or a `?:` between literals (`undefined`
and `null` are allowed as a branch). Template literals with expressions, `clsx(...)`, joined
arrays, several names, Bricks, Traits, Patterns, Tones and names no stylesheet defines are
reported. The same holds for a component's class props (`inputClassName`, any prop ending in
`ClassName`), for `className` in a literal object spread into an element (`{...{className: 'x'}}`),
and for the props object of `createElement` and the automatic runtime's `jsx` calls. A props object
built elsewhere is not followed. State goes into `data-*` and `aria-*` attributes; on an element whose
`className` is one Function, a literal value of an attribute that Function's state blocks select by
must be one they list (`data-status="payd"` is reported when the blocks select `paid` and `open`).
A block that selects by presence (`[data-busy]`) or another operator lets any value through. An
attribute with one styled value is not checked, since its other values are the Function's base look
(`data-state="idle"` beside a `busy` block), and `aria-*="false"` never is. A literal colour in an
inline `style` object (`style={{color: '#fff'}}`), in spread props or in `createElement` props paints
around the Roles and is reported too; a value computed at run time, such as a colour the user picked,
a `var(--color-…)` Role, a keyword that paints no colour of its own (`none`, `inherit`,
`currentColor`, `transparent`) and a `background` that is not a colour on its own (`url(…)`, a
gradient) are not.

## A complete stylesheet

```css
@import "tailwindcss";

:root {
  --palette-blue-600: #2563eb;
  --palette-blue-700: #1d4ed8;
  --palette-white: #fff;
}

@theme {
  --color-*: initial;
  --color-accent-fill: var(--palette-blue-600);
  --color-accent-fill-hover: var(--palette-blue-700);
  --color-accent-on-fill: var(--palette-white);
  --color-accent-edge: var(--palette-blue-600);
}

@utility tone-accent-solid {
  @apply bg-accent-fill text-accent-on-fill hover:bg-accent-fill-hover
    focus-visible:outline-accent-edge;
}
@utility shape-control { @apply h-10 px-4 rounded-md; }
@utility type-label { @apply text-sm font-medium; }
@utility focus-ring { @apply outline-2 outline-offset-2; }
@utility pattern-button { @apply shape-control type-label focus-ring; }

@layer components {
  .submit-button { @apply pattern-button tone-accent-solid; }
}
```

## Starting a stylesheet

```bash
npx carburetor-lint --init-classes src/styles/classes.css
```

writes a stylesheet with every floor filled with base classes and passing every rule:

- a Palette (Tailwind's grey, blue, red, green and amber for the default families; a custom family
  gets tokens named after it, to recolour) and the white the `on-fill` slot uses;
- the `--color-*: initial` reset and a Role for every family and slot, with `hover` and `active`
  states on `fill` and `wash`, and every surface level;
- a `[data-theme="dark"]` block that overrides the surface and neutral Roles;
- a Tone for every family and delivery, each with its family's focus ring, and a Tone per surface;
- the base Traits `shape-control`, `shape-field`, `shape-panel`, `shape-badge`, `type-body`,
  `type-label`, `type-heading`, `layout-row`, `layout-stack`, `focus-ring`, `motion-press`,
  `effect-raised` and `behavior-clickable`;
- the Patterns `pattern-button`, `pattern-field`, `pattern-card` and `pattern-badge`;
- example Functions — `submit-button`, `cancel-button`, `delete-button`, `search-field`,
  `content-card`, and `status-badge` with `data-status` state blocks — to replace with your own.

The vocabulary comes from the config's `classes` section when there is one, so custom families,
slots, deliveries, surface levels and trait kinds are scaffolded too. A Trait whose Bricks the
configured kinds do not own, a state with no Tailwind variant of its name (it gets a Role but no
Brick), and an example Function whose Pattern or Tone is missing are left out rather than written
wrong. Without a config the command creates `.carburetorrc.json` with a `classes` section naming the
new file; an existing config is never edited — the command prints what to add — and an existing
stylesheet is never overwritten. Import the file from your Tailwind entry and edit it from there.

## Turning the rules on

Add a `classes` section to `.carburetorrc.json`. Only `css` is required: the glob patterns, relative
to the config file, of the stylesheets that define the classes.

```json
{
  "classes": {
    "css": ["src/**/*.css"],
    "themeSelectors": [":root", "[data-theme]"],
    "families": ["neutral", "accent", "danger", "success", "warning"],
    "slots": ["fill", "on-fill", "wash", "ink", "ink-subtle", "edge"],
    "states": ["hover", "active"],
    "deliveries": {"solid": ["fill", "on-fill"], "soft": ["wash", "ink"]},
    "surfaceLevels": ["page", "raised", "sunken", "overlay"],
    "traitKinds": {"shape": ["width", "height", "padding*", "margin*"], "type": ["font-*"]}
  }
}
```

A key that is present replaces its default entirely; `*` in a trait-kind pattern matches any run of
characters. The section is validated when the config loads: two kinds owning one property, a
pattern that reaches a colour property, a delivery slot missing from `slots`, a family named
`surface` and an empty list are all configuration errors (exit code 2).

With the section, the rules report at `error`, except `no-unused-class`, which is for pruning and
stays off until switched on; each can be tuned under `rules` like any other.
Without it they are off, and switching one on in `rules` is a configuration error, since it would
have nothing to check against.

| Rule | Checks |
|---|---|
| [`valid-palette-token`](rules.md#functional-classes) | Palette names, place, literal values; only Roles reference the Palette |
| [`valid-color-role`](rules.md#functional-classes) | the `--color-*` reset, Role names and values, overrides only in theme selector blocks |
| [`valid-tone-class`](rules.md#functional-classes) | Tone names; only colour Bricks of the Tone's family and delivery slots |
| [`valid-trait-class`](rules.md#functional-classes) | no colour; every property owned by the Trait's kind |
| [`valid-pattern-class`](rules.md#functional-classes) | Traits only |
| [`valid-function-class`](rules.md#functional-classes) | place, name, selector, exactly one Tone, state blocks, no Bricks or declarations |
| [`no-unknown-class-reference`](rules.md#functional-classes) | every `@apply` class is a Tailwind utility or a defined class |
| [`no-duplicate-class`](rules.md#functional-classes) | one definition per name across the stylesheets |
| [`no-unused-class`](rules.md#functional-classes) | Palette tokens, Roles, Tones, Traits and Patterns nothing uses (off by default) |
| [`no-conflicting-classes`](rules.md#functional-classes) | no two classes of one `@apply` set the same property under the same variants |
| [`require-function-class`](rules.md#functional-classes) | markup carries one literal Function |

## How it runs

The `carburetor-lint` binary reads every configured stylesheet once, in parallel, before any file is
checked, and builds an index of what each one defines. It walks only the directories the `css`
globs start in (`src/styles` for `src/styles/**/*.css`), not the whole project. The stylesheet rules then run on each `.css`
file the walk reaches that matches `css`; the markup rule runs with the TypeScript rules and looks
classes up in the index. `--stdin` works for both kinds of buffer: an unsaved stylesheet stands in
for its file in the index, and an unsaved component is checked against the stylesheets on disk.

Through oxlint or ESLint, the plugin forwards the project's `classes` section and root to the
binary. The recommended preset ships every class rule `off` — a host config does not know whether
the project has a `classes` section — so turn the markup rule on in the host's own config to see
it in the editor:

```json
{"rules": {"carburetor/require-function-class": "error"}}
```

A cached answer is dropped when a stylesheet the `css` globs name changes, so a Function added to
the CSS stops being reported in an open component without a restart. The stylesheet rules report
only from the CLI, because neither host lints CSS. Suppression comments work in CSS too:
`/* carburetor-disable-next-line valid-tone-class */`.

A stylesheet the scanner cannot make sense of (an unclosed block, a stray `}`, an unclosed comment)
is not checked — rules over half a stylesheet would guess — but it is not silent: one
`valid-function-class` finding at the first problem says the file went unchecked. `@apply` lists
may carry `/* … */` comments; they are not read as classes.

## Limits

- The Brick table maps Tailwind v4's utilities to canonical property names; a utility it does not
  know is reported by `no-unknown-class-reference` until the table learns it. Arbitrary properties
  (`[mask-type:luminance]`) are understood.
- Values of known prefixes are not validated, so a misspelt value of a real prefix (`order-staus`)
  reads as a Brick.
- HTML, Vue and Svelte templates are not checked.
- `no-unused-class` reads only the stylesheets: a Role used only from markup
  (`style={{color: 'var(--color-accent-ink)'}}`) counts as unused.
- Sizes, spacing and radii still come from Tailwind's default scale; the methodology adds no floors
  for them yet.
