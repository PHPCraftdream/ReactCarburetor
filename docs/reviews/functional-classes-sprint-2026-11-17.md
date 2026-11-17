# Sprint plan: functional CSS classes and their native lint rules

Status: implemented 2026-11-17 on `ci/functional-classes` (CLS-1 … CLS-10); CLS-11 waits for approval
of a Tailwind devDependency. Task ids match the session TaskList. The user-facing description is
[`docs/functional-classes.md`](../functional-classes.md); §9 records where the implementation
departed from this plan.

Goal: native Rust rules that check, in one fast pass, that every floor of the class methodology
below is built correctly, and that markup carries only top-floor functional classes — no lower
floors, no Tailwind utilities. Every stage ships with tests; nothing is merged on a green build
alone.

## 1. The methodology being enforced

Markup gets one class per element, and that class names what the element does. Everything
visual is composed below it in floors; each floor may reference only the floor directly under it.

### 1.1 Colours — three floors

| Floor | Name | Where it lives | Name grammar | May reference |
|---|---|---|---|---|
| 1 | Palette | `:root` (outside `@theme`, so Tailwind generates no utilities for it) | `--palette-<hue>-<step>` | literal colour values only |
| 2 | Role | `@theme`; overrides in theme selectors (`[data-theme="dark"]`) | `--color-<family>-<slot>[-<state>]`, `--color-surface-<level>` | `var(--palette-…)` only |
| 3 | Tone | `@utility tone-…` | `tone-<family>-<delivery>`, `tone-surface-<level>` | colour Bricks on Role tokens only |

Closed lists (defaults, overridable in config):

- families: `neutral`, `accent`, `danger`, `success`, `warning`;
- slots: `fill`, `on-fill`, `wash`, `ink`, `ink-subtle`, `edge`;
- states: `hover`, `active`;
- deliveries and the slots each one may use: `solid` (`fill`, `on-fill`), `soft` (`wash`, `ink`),
  `outline` (`edge`, `ink`), `plain` (`ink`), `subtle` (`ink-subtle`);
- surface levels: `page`, `raised`, `sunken`, `overlay`; a surface Tone sets the level's
  background plus `neutral` ink and edge.

`@theme` must reset the stock palette with `--color-*: initial;`, so `bg-blue-600` does not exist.
The focus ring's colour belongs to the Tone (`focus-visible:outline-<family>-edge`); a Trait never
carries colour. The `dark:` variant is not allowed anywhere: themes switch only by overriding Role
variables.

### 1.2 Components — four floors

| Floor | Name | Where it lives | Name grammar | May reference |
|---|---|---|---|---|
| 1 | Brick | Tailwind utilities | — | — |
| 2 | Trait | `@utility <kind>-<name>` | `<kind>` from the configured trait kinds: `shape`, `type`, `layout`, `motion`, `focus` | non-colour Bricks whose CSS properties the kind owns |
| 3 | Pattern | `@utility pattern-<element>` | `pattern-<element>` | Traits only |
| 4 | Function | `@layer components` | `<purpose>-<element>`, at least two words | one Pattern and/or Traits, plus exactly one Tone |

- Each trait kind owns a disjoint set of CSS properties (`shape`: size, padding, margin, radius,
  border width; `type`: font, line height, letter spacing, text alignment and transform; `layout`:
  display, flex, grid, gap, alignment, position; `motion`: transition, animation, transform;
  `focus`: outline width, offset and style). Disjoint sets make `@apply` order irrelevant.
- A Function's name is not a Brick, and its first word is not reserved (`shape`, `type`, `layout`,
  `motion`, `focus`, `pattern`, `tone`, `palette`, `color`).
- A Function's selector is one class, optionally with one attribute selector:
  `.order-status`, `.order-status[data-status="paid"]`, or nested `&[data-status="paid"]`.
  No descendant selectors, no pseudo-classes (interaction states belong to the Tone's variants).
- A state block (the attribute form) contains exactly one `@apply tone-…` and nothing else.
- Functions contain no raw declarations. A Trait may hold raw declarations only of properties its
  kind owns, and never a colour.
- There are no "parts": every element gets its own functional name (`user-name`, not
  `user-card-title`).

### 1.3 Markup

`className` holds exactly one Function, written as a string literal, or a conditional/logical
expression whose every leaf is such a literal (`danger ? 'delete-button' : 'submit-button'`).
Template literals, `clsx`/`cn` calls, joined arrays, several names, Bricks, Traits, Patterns,
Tones and names that no CSS file defines as a Function are reported. Element state goes into
`data-*`/`aria-*` attributes.

## 2. Rules

| Id | Input | What it reports |
|---|---|---|
| `valid-palette-token` | CSS | a `--palette-*` outside a palette block, inside `@theme`, with a bad name, with a non-literal value, or referenced by anything but a Role |
| `valid-color-role` | CSS | a missing `--color-*: initial`, a `--color-*` name outside the grammar or the closed lists, a value other than `var(--palette-…)`, a Role override outside a theme selector |
| `valid-tone-class` | CSS | a Tone name outside the grammar; a non-colour Brick, a raw declaration, a `dark:` variant, a Role of another family, or a slot the delivery does not own |
| `valid-trait-class` | CSS | an unknown kind, a colour Brick or colour value, a property the kind does not own, a reference to anything but Bricks |
| `valid-pattern-class` | CSS | a reference to anything but Traits; a Tone, a Brick or a raw declaration |
| `valid-function-class` | CSS | a definition outside `@layer components` (or anything but a Function inside it), a bad name, a bad selector, no Tone or more than one Tone, a state block that does more than swap the Tone, a Brick, a raw declaration |
| `no-unknown-class-reference` | CSS | an `@apply` name that is neither a known Brick nor a defined class (catches typos and stock colours) |
| `no-duplicate-class` | CSS | the same class defined twice across the configured CSS files |
| `require-function-class` | TSX/JSX | any `className` that is not one defined Function, per §1.3 |

All nine are opt-in: they are off unless `.carburetorrc.json` has a `classes` section, so existing
Carburetor users see no change. None has an autofix (non-goal for this sprint). Registry count
grows from 42 to 51; bridge protocol stays 2 (unreleased since raised), only the contract
fingerprint changes.

## 3. Configuration

```json
{
  "classes": {
    "css": ["src/styles/**/*.css"],
    "themeSelectors": [":root", "[data-theme]"],
    "families": ["neutral", "accent", "danger", "success", "warning"],
    "slots": ["fill", "on-fill", "wash", "ink", "ink-subtle", "edge"],
    "states": ["hover", "active"],
    "deliveries": {
      "solid": ["fill", "on-fill"], "soft": ["wash", "ink"], "outline": ["edge", "ink"],
      "plain": ["ink"], "subtle": ["ink-subtle"]
    },
    "surfaceLevels": ["page", "raised", "sunken", "overlay"],
    "traitKinds": {
      "shape": ["width", "height", "min-*", "max-*", "padding*", "margin*", "border-radius*", "border-width*"],
      "type": ["font-*", "line-height", "letter-spacing", "text-align", "text-transform", "text-decoration-line"],
      "layout": ["display", "flex*", "grid*", "gap", "align-*", "justify-*", "place-*", "position", "inset*", "overflow*"],
      "motion": ["transition*", "animation*", "transform", "translate", "scale", "rotate"],
      "focus": ["outline-width", "outline-offset", "outline-style"]
    }
  }
}
```

Every key but `css` has the default shown. Validation errors (exit code 2, like every config
error): overlapping property sets between kinds, a delivery slot not in `slots`, a family
containing a reserved word, an empty `css` list, a bad glob.

## 4. Architecture

- `native/src/classes/` — the CSS front end, independent of oxc:
  - `parse.rs`: `cssparser` (exact pin, like the oxc crates) tokenises; an own structural pass
    collects at-rules (`@theme`, `@utility`, `@layer`, `@apply`), selectors, declarations and
    custom properties with byte spans. Malformed CSS becomes a diagnostic, never a panic.
  - `bricks.rs`: Tailwind v4 utility classifier — strips variants (`hover:`, `focus-visible:`,
    `aria-*:`, `data-[…]:`), handles arbitrary values (`px-[3px]`) and the `!` modifier, maps a
    utility to the CSS properties it sets, and recognises colour utilities by their Role token
    (`text-sm` is font size, `text-accent-ink` is colour, `text-red-500` is unknown). A static
    prefix table; no regex in the hot path.
  - `index.rs`: the project-wide class index — every definition with its floor, built once per
    run from the `css` globs, in parallel over files, then frozen and shared by reference.
- `native/src/rules/classes/<rule>/{mod.rs,tests.rs}` — one directory per rule, like the existing
  groups. CSS rules take the parsed file plus the index; they get their own registry beside
  `REGISTRY`, because `Check` takes an oxc `Program`.
- `require-function-class` is an ordinary oxc rule in `REGISTRY` with access to the index;
  `rule_possible` skips files without `className`.
- Walk: `.css` files are linted only when `classes` is configured and the file matches `css`.
  In `--stdin` mode (the editor path of the plugin bridge) the binary still builds the index from
  disk, so a single TSX buffer is checked against the real CSS.
- Suppression: `/* carburetor-disable-next-line <rule> */` and `/* carburetor-disable <rule> */`
  in CSS, sharing the existing directive grammar of `suppression.rs`.
- Plugin: `require-function-class` is registered as a `nativeRule`; the CSS rules exist only in
  the CLI (oxlint does not lint CSS). Not part of `recommended`; the docs show how to enable.

## 5. Stages and tasks

| Task | Stage | Depends on |
|---|---|---|
| CLS-1 | `classes` config section: parse, defaults, validation | — |
| CLS-2 | CSS front end: `cssparser` pin, structural parser, spans, CSS suppression comments | — |
| CLS-3 | Brick classifier for Tailwind v4 utilities | — |
| CLS-4 | Class index and floor resolution; walk and run order; `--stdin` index | CLS-1, CLS-2, CLS-3 |
| CLS-5 | Colour rules: `valid-palette-token`, `valid-color-role`, `valid-tone-class` | CLS-4 |
| CLS-6 | Component rules: `valid-trait-class`, `valid-pattern-class`, `valid-function-class`, `no-unknown-class-reference`, `no-duplicate-class` | CLS-4 |
| CLS-7 | Markup rule `require-function-class` + plugin `nativeRule` | CLS-4 |
| CLS-8 | Integration: registry/severities, rule counts, fingerprint, CLI fixture project, conformance | CLS-5, CLS-6, CLS-7 |
| CLS-9 | Performance: lint-binary scenario with CSS + TSX, scaling gates | CLS-8 |
| CLS-10 | Documentation: methodology guide, rule reference, native README, CHANGELOG | CLS-8 |
| CLS-11 | Reference project compiled by Tailwind v4 in CI (needs approval for the devDependency) | CLS-10 |

CLS-1, CLS-2, CLS-3 touch disjoint files and can run in parallel; so can CLS-5, CLS-6, CLS-7
once CLS-4 lands (each owns its rule directories; registry rows are merged by the orchestrator).

## 6. Tests per stage

Local runs are limited to `cargo check`/`clippy`/`fmt`; every test below runs in CI.

- **CLS-1** — `config/tests`: defaults when keys are omitted; each validation error with its
  message; `classes` absent keeps all nine rules off; partial overrides merge with defaults.
- **CLS-2** — parser unit tests: `@theme` with `--color-*: initial`, `@utility` with `@apply` and
  variants, `@layer components` with plain and nested state selectors, comments and strings
  containing braces, `@import`/`@source` ignored, malformed input (unclosed block, stray `}`)
  reported with a span, CRLF line endings, UTF-8 before the reported offset; suppression comments.
- **CLS-3** — table-driven classifier tests: every prefix in the table, variants stacked
  (`hover:focus-visible:`), arbitrary values and properties (`[mask-type:luminance]`), negative
  values (`-mx-2`), the `!` modifier, colour versus size for `text-`/`border-`/`outline-`/`ring-`,
  stock colours as unknown, `/50` opacity modifiers on Role colours.
- **CLS-4** — index tests: every floor recognised by name and place; one definition per name
  across files; deterministic order regardless of thread scheduling; a CSS file outside `css` is
  ignored; `--stdin` sees the on-disk index.
- **CLS-5, CLS-6** — for each rule a valid fixture that reports nothing and one invalid fixture
  per bullet of its row in §2, each asserting rule id, message and line/column; suppression
  silences exactly the targeted line.
- **CLS-7** — valid: one literal, conditional and `&&` leaves; invalid: two names, a Brick, a
  Trait/Pattern/Tone, an unknown name, a template literal, `clsx(…)`, `[…].join(' ')`, a spread
  props object carrying `className` is ignored (documented); plugin bridge test through the
  existing native test harness.
- **CLS-8** — `native/tests/cli.rs` end-to-end on a fixture project (`tests/fixtures/classes/`)
  with the reference CSS from §1 and TSX that uses it: clean project exits 0; an offender project
  yields the expected JSON diagnostics; `--stdin`; config errors exit 2. Conformance and
  `examples/wrong` entries for the markup rule; rule-count and fingerprint checks updated.
- **CLS-9** — `perf/scenarios` lint-binary scenario generating N Function classes in CSS and N TSX
  files using them; gates at 2k and 8k with the 8k/2k time ratio budget used by
  `perf/gates/lintBinary.mjs` (≤ 12); registered in `perf/ci/contract/gate-baseline.json`.
- **CLS-10** — `docs:check` passes; every rule id in the registry has a section in
  `docs/rules.md` (existing coverage check).
- **CLS-11** — CI job compiles the reference project with Tailwind v4 and asserts that each
  Function produces CSS and that `bg-blue-600` produces nothing (proves `--color-*: initial` and
  that `@apply` of custom utilities composes as the methodology assumes).

## 7. Non-goals

Autofixes; HTML/Vue/Svelte templates; `style={…}` props; checking that `data-*` values used in
markup match the CSS state selectors; spacing/radius token floors (the stock Tailwind scale stays
the Brick vocabulary for sizes for now).

## 8. Definition of done

All eleven tasks closed with CI green on `ci/**` and fast-forwarded to `master`; the rule count,
fingerprint, CHANGELOG `[Unreleased]` and docs updated; no version bump and no publication
without an explicit command.

## 9. Decisions taken during implementation

- **Own scanner instead of `cssparser`.** The rules need structure only (blocks, at-rules, `@apply`,
  declarations, comments, strings, brackets); a 300-line scanner covers it with no new dependency
  and bounded recursion. `native/src/rules/classes/css/parse/`.
- **Layout.** The front end lives in `native/src/rules/classes/css/` (parse, scan, names, index,
  bricks, settings); the rules are grouped `colour/`, `component/`, `reference/` plus
  `require_function_class/`. The repository's seven-entries rule also moved `config/depth.rs` and
  `config/scope.rs` into `config/options.rs`, `ConfigError` into `config/error.rs`, the plugin's
  `Rules/Reads` and `Rules/Writes` under `Rules/Data/`, and the plugin's class wrappers into
  `Rules/Classes/{Colour,Component,Reference}`. Paths only.
- **Two more trait kinds.** `effect` (opacity, shadows, filters, blend modes) and `behavior`
  (cursor, pointer events, selection, touch, scroll), so every property the Brick table emits has
  exactly one default owner (a unit test pins this).
- **"A Function name is not a Brick" dropped.** The Brick table does not validate values, so
  `order-status` would read as the `order` utility; reserved first words stay.
- **A stylesheet that does not scan reports nothing**, like a TypeScript file that does not parse.
- **The bridge.** It forces every rule on from the command line, so a class rule switched on there
  without a `classes` section is not an error (it has nothing to read); in the config file it still
  is. The bridge forwards the project rc's `classes` with a new top-level `root` key, because its
  generated config lives in a temp directory.
- **Conformance and `examples/wrong`.** Both run without a `classes` section, so the class rules are
  covered by `native/tests/classes.rs` (the real binary over generated projects) and by
  `__tests__/Native/basesBridge.test.ts` (the forwarded section) instead.
- **Perf.** `perf/gates/lintClasses.mjs` (`lint-binary/classes@2k`, `@8k`), registered in the gate
  contract.
