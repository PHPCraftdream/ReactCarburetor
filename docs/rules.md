# Lint rules

The rules ship with the package as `@react-carburetor/core/lint`. This page is the reference by rule
name; [hazards.md](hazards.md) is the same material organised by mistake, with the code that
triggers each one, why it is silent at runtime, and where the rule can be wrong.

The recommended rules protect carburetor logic and allocation hygiene. The separately enabled
`no-hooks` preset adds a component-architecture policy. The plugin registry contains **53 rules**:
31 catalogue rules, `require-hoisted-constant`, three `useStoreEffect` rules (`no-store-read-in-effect-deps`,
`no-inline-store-effect`, `prefer-store-effect`), the `no-unrecognized-base` setup check, the
optional `no-react-hooks-in-components` policy, five house-style rules, and eleven opt-in
[functional-class rules](#functional-classes). The native registries also have 53 entries: 43 over
TypeScript and ten over stylesheets. `no-module-level-store` and `one-export-per-file` are off in
recommended configuration; the functional-class rules are off until a `classes` section turns them on.

## Functional component reads

For subscribed client renders, use `useCarburetorValue` for store selections and
`useComputedValue` for derived values; resource reads use `useResourceValue`. In `AntiHookComponent`
classes, use `this.useCarburetor`/`this.useComputed` instead. Do not replace functional reads with
`getData()` or `get()` (H1/H2), and do not start resource work or write stores during render (H11);
move events to handlers and external synchronization to the appropriate resource/effect API, not
React effects for synchronous store reads. H33/H34 cover memoization over hook reads and capturing
hook selectors. H21/H31 also concern function-component render functions; H30 independently covers
eligible module-function extraction (`scope: "all"` by default). H4/H5/H29 are class-only rules.

| Rule | Applies to function-component render? | Advice |
|------|----------------------------------------|--------|
| H1, H2, H11, H21, H30, H31, H33, H34 | Yes | Use subscribed reads; move writes/work to handlers or effects; stabilize/hoist callbacks; derive in selectors and avoid captured selectors. |
| H4, H5, H29 | No | These are class-only; use the corresponding class API and advice. |

Server Components may make a one-shot `getData()` read because no client subscription exists there;
prefer the documented line-level suppression example below. In `.ts`, `React.createElement` render detection is not recognized; use TSX when relying on JSX-based render
recognition.

## no-get-data-in-render (H1)

Use `useCarburetorValue` in function components and `this.useCarburetor` in `AntiHookComponent`
classes instead of `getData()` during render. Server Components are the exception: they have no
client subscription, so a one-shot read is appropriate. Explain the exception on the preceding
JavaScript line when suppressing it:

```text
// carburetor-disable-next-line carburetor/no-get-data-in-render -- Server Component: one-shot read, no subscription exists on the server
const data = store.getData();
```

For an `AntiHookComponent`, the corresponding class API is `this.useCarburetor`; the function API is
`useCarburetorValue`. To turn off the rule only for known Server Component pages, use a real oxlint
configuration file and limit the override carefully: a page may be a Client Component.

```json
{
  "overrides": [
    {
      "files": ["app/server/page.tsx"],
      "rules": {"carburetor/no-get-data-in-render": "off"}
    }
  ]
}
```

Only use this override when those matched pages are known Server Components; a `'use client'` page
can still need the subscription this rule protects.

## House-style preset (optional)

Use the house-style preset alongside `recommended` to opt into project-wide source conventions. It is
additive, not a replacement: extend it second so the recommended correctness rules remain enabled.

```json
{
  "extends": [
    "@react-carburetor/core/lint/recommended.oxlintrc.json",
    "@react-carburetor/core/lint/house-style.oxlintrc.json"
  ]
}
```

The preset enables `max-line-length`, `no-blank-line-after-tsdoc`, `no-parent-import`,
`require-tsdoc`, `tsdoc-blank-line-before-tags`, and `one-export-per-file` as errors. It enables
`prefer-readonly-array-param` as a warning. The corresponding `@react-carburetor/core/lint` plugin config
is available as `house-style`.

`no-parent-import` needs the source roots it may alias (each a `{path, prefix}` pair, for example
`{"path": "src", "prefix": "@/"}`), in its own entry —
`"carburetor/no-parent-import": ["error", {"roots": [...]}]` — or under
`settings.carburetor.ruleOptions["no-parent-import"].roots`. Switched on without any, it reports once
per run that it checks nothing, and the native CLI rejects such a config.

The native CLI can use equivalent severities in `.carburetorrc.json`:

```json
{
  "rules": {
    "carburetor/max-line-length": "error",
    "carburetor/no-blank-line-after-tsdoc": "error",
    "carburetor/no-parent-import": "error",
    "carburetor/prefer-readonly-array-param": "warn",
    "carburetor/require-tsdoc": "error",
    "carburetor/tsdoc-blank-line-before-tags": "error",
    "carburetor/one-export-per-file": "error"
  }
}
```

This preset applies those severities only; rule-specific options such as `no-parent-import` roots
must be configured for the native CLI separately (the CLI rejects `no-parent-import` switched on
without roots). See the individual rule entries below for
available options. These configurations are not promised to override the plugin's native bridge.

## Setup

**oxlint** — one line; the preset travels inside the package, and it also switches oxlint's
`typescript/unbound-method` off, which cannot see `@bind`:

```json
{
  "extends": ["@react-carburetor/core/lint/recommended.oxlintrc.json"]
}
```

The direct path works where a host does not resolve package exports:

```json
{
  "extends": ["./node_modules/@react-carburetor/core/dist/lint/recommended.oxlintrc.json"]
}
```

**ESLint v9+** — spread the shareable config. `@typescript-eslint/parser` must be installed in
lint tooling and named in `languageOptions`, as below; the shareable config does not configure
parsing itself.

<!-- example:file examples/api/lint/Recommended.js#doc -->
```js
import tsParser from '@typescript-eslint/parser';
import carburetor from '@react-carburetor/core/lint';

export default [
    {
        ...carburetor.configs.recommended,
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {parser: tsParser},
    },
];
```

Either way, a rule can be changed or switched off afterwards, since a later entry wins:

```json
{
  "extends": ["./node_modules/@react-carburetor/core/dist/lint/recommended.oxlintrc.json"],
  "rules": {
    "carburetor/no-escaping-tracked-data": "off",
    "carburetor/no-module-level-store": "error"
  }
}
```

A single line is silenced with `// oxlint-disable-next-line carburetor/<rule>` or
`// eslint-disable-next-line carburetor/<rule>`, placed directly above the reported line. A whole
file takes `/* oxlint-disable carburetor/<rule> */`. Say why when silencing a rule.

### Hook-free components (optional)

React hooks remain allowed by `recommended`. Enable the optional preset explicitly:

```json
{
  "extends": [
    "./node_modules/@react-carburetor/core/dist/lint/recommended.oxlintrc.json",
    "./node_modules/@react-carburetor/core/dist/lint/no-hooks.oxlintrc.json"
  ]
}
```

The JSON is also exported as `@react-carburetor/core/lint/no-hooks.oxlintrc.json`. ESLint v9+ uses the
same policy through the plugin's shareable config:

<!-- example:file examples/api/lint/NoHooks.js#doc -->
```js
import tsParser from '@typescript-eslint/parser';
import carburetor from '@react-carburetor/core/lint';

export default [
    {
        ...carburetor.configs.recommended,
        files: ['src/**/*.{js,jsx,ts,tsx}'],
        languageOptions: {parser: tsParser},
    },
    {
        ...carburetor.configs['no-hooks'],
        files: ['src/**/*.{js,jsx,ts,tsx}'],
        languageOptions: {parser: tsParser},
    },
];
```

`no-react-hooks-in-components` rejects statically resolved React `use` and `useX` calls in
PascalCase components, functions returning JSX, React `memo`/`forwardRef` callbacks, anonymous
default exports, and recognized component classes. Named and namespace imports, CommonJS
`require('react')`, destructuring, literal member names and unchanged local aliases retain React
provenance. Local shadowing, type-only imports and use-prefixed functions from other modules do not.
Instance methods such as `this.useCarburetor()` are not React hooks.

This rule has no automatic conversion: changing component ownership requires a design decision.
Local forwarding follows at most eight alias links. Dynamic property names and cross-module wrapper
implementations are not inferred. It enforces a static architecture boundary, not a proof of zero
allocations: React still allocates, and a hook-free component can allocate in its own render.

## The rules

`error` means the mistake silently loses an update, a subscription or a re-render. `warn` means the
rule rests on a heuristic you have to judge. `off` means the rule contradicts a correct pattern
until your project changes shape.

| Rule | Level | Catches | Hazard |
|------|-------|---------|--------|
| `max-render-depth` | warn | A render whose component tree is deeper than the configured limit; configurable depth | [H35](hazards.md) |
| `max-line-length` | off | A source line longer than the configured limit; house style, opt-in | — |
| `no-blank-line-after-tsdoc` | off | A blank line between a TSDoc block and the declaration it documents; house style, opt-in | — |
| `no-parent-import` | off | An import reaching up out of its directory instead of through the configured alias; house style, opt-in | — |
| `prefer-readonly-array-param` | off | Non-mutating array parameters; opt-in syntactic heuristic | [H37](hazards.md) |
| `require-tsdoc` | off | A function, method or function-valued member without a short TSDoc block; house style, opt-in | — |
| `tsdoc-blank-line-before-tags` | off | A missing blank line between a TSDoc description and its first block tag; house style, opt-in | — |
| `no-async-effect` | error | An `async` effect body (of `this.useEffect` or `this.useStoreEffect`), whose returned promise is taken for a cleanup and dropped | [H14](hazards.md) |
| `no-async-transaction` | error | An `async` body given to `transaction()` (a value import from `@react-carburetor/core`) or `this.update()`, which closes the batch at the first `await` | [H17](hazards.md) |
| `no-closure-in-update` | warn | A capturing inline callback passed to `this.update` in a recognized store member; pass a module-level mutator and its arguments to `this.update` instead | [H32](hazards.md) |
| `no-computed-get-in-computed` | error | A computed reading a source with `get()`/`getData()` instead of its reader, so it registers no dependency and never invalidates | [H3](hazards.md) |
| `no-computed-get-in-render` | error | A computed read with `get()` in render, which registers no subscription | [H2](hazards.md) |
| `no-direct-data-write` | warn | A store writing to `this.data`, which records no path and invalidates everything | [H7](hazards.md) |
| `no-duplicate-effect-name` | error | Two effects under one name (`this.useEffect` or `this.useStoreEffect`, which share one record), where the second overwrites the first one's cleanup | [H15](hazards.md) |
| `no-escaping-tracked-data` | warn | Tracked data stored on the component or captured by a function that runs after the render | [H5](hazards.md) |
| `no-external-data-mutation` | error | A write through `getData()`, which notifies nobody and mutates shared snapshots | [H8](hazards.md) |
| `no-function-in-render` | warn | A function built in render for a DOM attribute/local/declaration or synchronous array callback; yields to H29/H30 at the same position | [H31](hazards.md) |
| `no-get-data-in-render` | error | `getData()` in render, so the component never subscribes and freezes | [H1](hazards.md) |
| `no-handler-created-in-render` | warn | A handler built in render and passed to a child, which defeats the props gate | [H21](hazards.md) |
| `no-lifecycle-class-property` | error | A lifecycle method declared as a class property, shadowing the base implementation | [H13](hazards.md) |
| `no-module-level-store` | off | A store created once per module, which a server shares across requests | [H18](hazards.md) |
| `no-unrecognized-base` | warn | A class that uses the engine through an imported base class not listed in `componentBases`/`storeBases`, so no rule checks it; setup check | — |
| `no-store-read-in-effect-deps` | warn | An effect dependency taken with `getData()`, which is compared only when the component re-renders for another reason, so the effect does not follow the store; use `useStoreEffect` | — |
| `no-inline-store-effect` | error | A selector or effect written inline (an arrow, a function expression, a `.bind(...)`, or a function a constant of the same method holds) and handed to `useStoreEffect`, which re-subscribes and re-runs the effect on every render | — |
| `prefer-store-effect` | warn | A store's `watch(select, onChange)`, a computed's `watch(onChange)` or a `storeEffect(...)` started by hand in a `this.useEffect` callback or `componentDidMount`, or started in `render`, where every render subscribes again; use `useStoreEffect` | — |
| `no-memo-over-store-read` | warn | `useMemo`/`useCallback` over hook-read values; derive in the selector or a `Computed` | [H33](hazards.md) |
| `no-capturing-hook-selector` | warn | Inline hook selector captures render state; select whole record then pick, or use `AntiHookComponent#useCarburetor` without a selector | [H34](hazards.md) |
| `one-export-per-file` | off | A second runtime-value export in one file; every file ships at most one value, type exports are unlimited | [H36](hazards.md) |
| `no-react-hooks-in-components` | off | React `use`/`useX` calls in components when the optional hook-free policy is enabled | [Optional policy](#hook-free-components-optional) |
| `no-store-write-in-render` | error | A write to a store while rendering, which notifies subscribers mid-render | [H11](hazards.md) |
| `no-tracked-data-mutation` | error | A write to data from `useCarburetor`, which throws | [H9](hazards.md) |
| `no-untrackable-draft-mutation` | warn | An in-place change to a `Map`, `Set` or `Date` through `draft`, which costs all path precision | [H10](hazards.md) |
| `no-untrackable-store-data` | warn | `Map`, `Set` or `Date` in a store's data, which tracking and `snapshot()` both pass over | [H19](hazards.md) |
| `no-use-carburetor-outside-render` | error | `useCarburetor`/`useComputed` outside render, where they establish no subscription | [H4](hazards.md) |
| `require-bind-for-passed-method` | error | A component method passed as a value without `@bind`, losing its receiver | [H22](hazards.md) |
| `require-effect-deps` | warn | A prop or piece of state read by an effect but missing from its dependencies | [H16](hazards.md) |
| `require-emit-after-draft-write` | error | A method that writes through `draft` and never publishes | [H6](hazards.md) |
| `require-hoisted-constant` | warn | A `Set`/`Map` of constants, or a string assembled only from constants (an import or a module-level `const` with literals), built inside a function on every call; build it once at module level | — |
| `require-method-for-closure` | warn | A closure inside a class member that depends only on the class, rebuilt on every call of the member — declare it as a method | [H29](hazards.md) |
| `require-module-function` | warn | A clean nested function needing no surrounding invocation state, or an eligible component member needing no class; configurable scope | [H30](hazards.md) |
| `require-subscription-disposal` | warn | A subscription whose id is discarded, or a `watch` or `storeEffect` whose disposer is, so it can never be released | [H20](hazards.md) |
| `require-super-in-lifecycle` | error | A lifecycle override that skips `super`, disabling effects, cleanup or the props gate | [H12](hazards.md) |
| `valid-palette-token` | off¹ | A `--palette-*` token in `@theme`, outside a theme selector block, misnamed or not a literal colour; a Palette reference from anything but a Role | [Functional classes](#functional-classes) |
| `valid-color-role` | off¹ | A missing `--color-*: initial` reset; a Role name outside the grammar or the closed lists; a Role value other than one `var(--palette-…)`; an override of an undefined Role | [Functional classes](#functional-classes) |
| `valid-tone-class` | off¹ | A Tone name outside the grammar; a non-colour Brick, raw colour, another family's Role or a slot its delivery does not use | [Functional classes](#functional-classes) |
| `valid-trait-class` | off¹ | A colour in a Trait; a property another kind owns or no kind owns; another floor applied | [Functional classes](#functional-classes) |
| `valid-pattern-class` | off¹ | Anything but Traits in a Pattern | [Functional classes](#functional-classes) |
| `valid-function-class` | off¹ | A Function outside `@layer components`, misnamed, with a bad selector, no Tone or several, a Brick, a declaration or a variant; a state block that does more than swap the Tone; a utility on no floor | [Functional classes](#functional-classes) |
| `no-unknown-class-reference` | off¹ | An `@apply` class that is neither a Tailwind utility nor defined by the configured stylesheets, or a colour naming no Role | [Functional classes](#functional-classes) |
| `no-duplicate-class` | off¹ | A second definition of a Palette token, Role, utility or Function | [Functional classes](#functional-classes) |
| `no-conflicting-classes` | off¹ | Two classes of one `@apply` list that set the same property under the same variants (after expanding Functions, Patterns and Traits), so the order of `@apply` decides the value | [Functional classes](#functional-classes) |
| `no-unused-class` | off | A Palette token no Role reads, a Role no colour Brick or `var()` uses, a Tone, Trait or Pattern no `@apply` names; off even with a `classes` section, for pruning | [Functional classes](#functional-classes) |
| `require-function-class` | off¹ | A `className` (or `*ClassName` prop, literal spread object, `createElement`/`jsx` props object) that is not one Function written as a literal | [Functional classes](#functional-classes) |

¹ `error` once `.carburetorrc.json` has a `classes` section.

### prefer-readonly-array-param (H37)

The rule recommends `readonly` for simple identifier parameters `T[]` or `Array<T>`, including
optional and defaulted parameters on functions, methods and arrows. Fixes are shallow:
`readonly T[]` or `ReadonlyArray<T>`.

Rest/destructured parameters, bodyless declarations, abstract methods and `.d.ts` files are skipped.
Ordinary constructor parameters remain eligible; constructor properties are skipped. The rule only
reports whole parameters in approved positions. Member reads and nonmutator method calls, for-of
iteration, spread into arrays/calls/objects, comparisons, `typeof`/`in` checks and conditions are
safe. Any whole-parameter use in an unapproved position suppresses the report. Nested functions
are scanned under the same policy.

This rule is not type-aware. TypeScript catches readonly-to-mutable array incompatibility but does
not infer readonly intent for APIs that only read. The fix can affect caller assignability, so it is
off by default. Enable it only when the ergonomics tradeoff is appropriate; indirect mutation or
retention is not inferred.

## Fixed recognition and configuration

Render detection is syntactic: a PascalCase function whose own return contains JSX, or a callback passed as the first argument to `memo`/`forwardRef` (including `React.`-qualified forms) whose own return contains JSX. Nested functions end that render scope, except synchronous array callbacks. `React.createElement` in `.ts` is not detected; this is not type-aware.

The preset's recognitions are fixed and syntactic:

| Kind | Recognised names |
|------|------------------|
| Store | `Carburetor`, `ResourceCarburetor`, `ResourceCache` |
| Component | `AntiHookComponent`, `ScopedAntiHookComponent` |
| Render | `render` |

Recognition follows the `extends` chain within one file: a local `class Rows extends Layout` is
component (or store) code when `Layout` extends a recognised base in the same file. An imported
base stops the walk — a project-local base is configured instead, with the `componentBases` and
`storeBases` keys of `.carburetorrc.json`, which add names to the built-in lists for every rule:

```json
{
  "componentBases": ["AppComponent"],
  "storeBases": ["UsersCache"]
}
```

The keys apply to the native CLI and to the ESLint/oxlint plugin alike: the plugin takes
`settings.carburetor.componentBases` / `settings.carburetor.storeBases` from the host config, and
falls back to the same two keys of `.carburetorrc.json` when the host passes no settings. The
plugin reads a project rc only for those two keys: a missing file is the same as empty lists,
while one that cannot be read or holds malformed lists is an error, as in the CLI. Other keys of
`.carburetorrc.json` (per-rule options) never reach the plugin's shared native run; rule options
are passed through the host instead.

The native CLI also accepts `overrides` in `.carburetorrc.json`. Actual input paths resolve from
the process working directory, then are made relative to the config directory (or CWD for the
default config). Relative and absolute inputs under that directory match; paths outside it do
not. The last matching entry wins per rule. A command-line `--rule` severity takes priority over
all config severities, while the matching override's options remain in effect. This is native-only:
oxlint implements its own `overrides` behavior for JavaScript plugin rules; keep those entries in
oxlint's configuration.

```json
{
  "overrides": [
    {
      "files": ["**/*.test.*", "**/__tests__/**", "e2e/**"],
      "rules": {"carburetor/require-module-function": "off"}
    }
  ]
}
```

Most rules accept severity only: `error`, `warn` or `off`; `require-module-function` also accepts
the `scope` option (`"all"` or `"classes"`) and `max-render-depth` accepts `max` (an integer >= 1).
Unknown option values, option keys and base-list
shapes are malformed configuration. Suppress reports with
`// carburetor-disable-next-line <rule>` or `// carburetor-disable <rule>`; either directive without
a rule list silences all Carburetor rules.


### Test registration callbacks

`require-module-function` and `require-subscription-disposal` do not report code inside a function
handed to a test registrar: `describe`, `it`, `test`, `suite`, `bench`, `beforeEach`, `afterEach`,
`beforeAll`, `afterAll`, `before`, `after` and their `x`/`f` variants, through the chains runners add
(`it.only`, `test.concurrent.skip`, `describe.each(table)`, `` test.each`table` ``,
`test.skipIf(condition)`). The runner calls such a callback once, so nothing in it is rebuilt per
call, and a subscription made in a test lives as long as the test, not the process. The registrar is
recognised by its name only when that name is a global or an import; a function the file declares
under the same name is ordinary code. Module-level code of a test file is checked as before, and no
`overrides` entry for test files is needed for these two rules.

### `require-module-function`: `scope`

```json
{
  "rules": {
    "carburetor/require-module-function": ["warn", {"scope": "classes"}]
  }
}
```

- `"all"` is the default. Analyze nested functions throughout the file, including module functions
  and class members.
- `"classes"` limits nested-function findings to class bodies. Clean callbacks inside component and
  store methods remain findings, including callbacks passed to `this.update`.

Both modes retain eligible component-member analysis. Module-level declarations are not nested
function findings. Each H30 JSON diagnostic carries `scope: "class"` or `scope: "module"`. Type-only references, including `typeof x` in a type position, do not count as runtime captures; a callback depending on an enclosing generic type may still need a promoted or generalized signature when moved. Component JSX prop callbacks belong to H21, not H30. The
JavaScript bridge obtains one complete native result and applies the host's `context.options` when
reporting it. Its native invocation carries only the base-class keys (`componentBases` /
`storeBases`), taken from `settings.carburetor` or the project `.carburetorrc.json`, so the rc
cannot silently narrow the result requested by an ESLint or oxlint rule option. Direct native CLI
invocations honor the whole `.carburetorrc.json`. Native configuration rejects an unknown scope or
option key as malformed configuration and exits with code 2. Options for other native rules retain
their existing behavior.

### `max-render-depth`: `max`

```json
{
  "rules": {
    "carburetor/max-render-depth": ["warn", {"max": 3}]
  }
}
```

- `3` is the default. A render is reported when the deepest root-to-leaf path holds more than
  `max` components; one diagnostic lands on the element that first exceeds the limit.
- Only components count: PascalCase or member names. DOM tags and fragments nest without
  counting; JSX in attributes and expression children continues the owning element's depth.

Native configuration rejects an unknown option key, a non-integer or a value below 1 as
malformed configuration and exits with code 2. The option is honored by the native CLI's
configuration; the ESLint/oxlint bridge runs the binary with a neutral configuration, so the
default depth of 3 applies there.

## One rule replaces a built-in

`typescript/unbound-method`, and `@typescript-eslint/unbound-method`, cannot see the `@bind`
decorator and report correct usage as an error. Switch it off and keep
`carburetor/require-bind-for-passed-method`, which knows about the decorator and also reports the
opposite mistake — a method passed as a value *without* it. The oxlint preset ships with
`typescript/unbound-method` already off; an ESLint setup switches it off itself.

### Function-component render allocations

H21 and H31 also recognize function-component render scope syntactically: the function’s own return must contain JSX, or it must be a JSX-returning callback passed to `memo`/`forwardRef` (including React-qualified forms); nested functions end that scope. H21 reports inline functions and `.bind(...)` calls passed to child-component props; H31 reports render-created functions at its documented allocation sites. A locally declared handler passed as `useCallback(handler)` or `useMemo(() => handler)` is not an H21 finding at the prop: its declaration is H31 if it captures a non-module outer binding, or H30 if capture-free. An inline function inside a hook call used as the prop remains H21. Module-level advice for H21/H31 applies only when the function does not reference any non-module outer binding, lexical `this`, or `arguments`; factories and HOCs that capture render state should use a hook-free child component instead.

## one-export-per-file (H36)

This rule warns when a file declares a second runtime-value export; every file ships at most one
value, and type exports are unlimited. Counted forms: each variable binding including every
destructured name, function declarations (an overload set counts once per name), classes, enums,
namespaces with runtime content, default exports, `export =`, and each specifier of a local
`export {x}`. Not counted: type and interface exports, type-only export lists, `declare` ambience,
`.d.ts` files and re-export barrels. The default severity is `warn`.

## no-memo-over-store-read (H33)

This rule warns when `useMemo` or `useCallback` in a recognized function-component render refers to a local binding initialized by `useCarburetorValue`, `useComputedValue` or `useResourceValue` in that same component. It does not report a memo whose callback has no such same-component hook-read binding. Prefer deriving in the selector, or use a `Computed` read with `useComputedValue`; the default severity is `warn`.

## no-capturing-hook-selector (H34)

This rule warns when an inline selector passed as argument 2 to `useCarburetorValue(source, select, isEqual?)` or argument 3 to `useResourceValue(source, args, select, isEqual?)` captures a parameter or local binding from the recognized component render. `useComputedValue(computed)` has no selector and is not covered by H34. It does not report capture-free selectors, which remain H30-only and are not duplicated by H34. Prefer selecting the whole record then picking fields during render; the default severity is `warn`.

## `no-store-read-in-effect-deps`

`useEffects` runs after the commit and compares an effect's dependencies only then, so a value taken
with `getData()` is compared only when the component re-renders for some other reason: the effect
does not run again when the store changes, and it seems to work only while `render` happens to read
the same field. The rule reports, inside a `useEffects` method, a `this.useEffect` dependency that
calls `getData()`, that names a constant of the same method initialized from `getData()` (destructured
or not), or a whole dependency array held in such a constant. Follow store data with
`useStoreEffect(name, store, select, effect)` instead. It is `warn` in the recommended preset.

## `require-hoisted-constant`

A string literal costs nothing per call: the engine keeps one copy, and moving it into an imported
constant changes nothing (measured: no young-generation collections either way). What a function
*builds* does cost, every call: `new Set([WILDCARD])` allocates a set and an array, `PREFIX + '.'`
and `` `${PREFIX}.` `` allocate a new string, and none of them can differ between calls. On V8 a
per-call `new Set([x])` measured about fifteen times slower than reading a hoisted one, a
concatenation about four times, and both feed the collector. The rule reports such a value inside a
function when every part is a literal, an import, a module-level `const` or a member of one. An
empty collection (a fresh mutable value by intent), a concatenation of literals only (folded by the
engine), and a message built for `new …Error(...)` or a `throw` (a cold path) are left alone, and
so is code in test callbacks. Values that depend on an argument cannot be hoisted and are not this
rule's business. It is `warn` in the recommended preset.

## `no-inline-store-effect`

`useStoreEffect(name, store, select, effect)` keeps `[store, select, effect]` as its effect's
dependencies, and `useEffects` runs on every render. A selector or effect written inline is a new
function each time, so every render unsubscribes, subscribes again and runs the effect once more with
no previous value: an autosave saves on every render, a request repeats, and nothing fails. The rule
reports, in a `this.useStoreEffect` call, a selector or effect that is an arrow, a function
expression, a `.bind(...)` call, or a name a constant or nested function of the same method holds.
Pass a module-level function or a method (`this.save`) instead. It is `error` in the recommended
preset.

## `prefer-store-effect`

A `watch(select, onChange)` on a store, or `watch(onChange)` on a computed, started inside a
`this.useEffect` callback or in `componentDidMount` is the code `useStoreEffect` replaces: the
component has to run the effect for the current value itself, keep the disposer, and order the run's
cleanup against the watch's. `this.useStoreEffect(name, store, select, effect)`, or
`(name, computed, effect)`, does all three. A store watching itself (`this.watch`) and calls whose
arguments cannot be callbacks (`fs.watch('dir')`) are not reported. A `storeEffect(...)` started the same way is reported too, and a `storeEffect` or `watch` started
in `render` is reported because every render subscribes again and nothing stops the earlier ones. It is `warn` in the recommended
preset.

## Functional classes

Eleven rules enforce the [functional CSS class methodology](functional-classes.md) in Tailwind v4
projects: markup carries one class that names what an element does, and colours and components are
composed below it in floors that may each use only the floor under them. They are off until
`.carburetorrc.json` has a `classes` section naming the stylesheets (`{"classes": {"css":
["src/**/*.css"]}}`); with it, all but `no-unused-class` report at `error` (that one is for pruning and stays off until switched on).
Ten check the stylesheets and run only
in the `carburetor-lint` CLI, because neither oxlint nor ESLint lints CSS; `require-function-class`
checks markup and also reports through the plugin. The methodology page lists what each rule
checks, the configuration keys and their defaults, and the limits.

## Setup check: `no-unrecognized-base`

Recognition is syntactic and follows `extends` only through classes declared in the same file. A
component or store that extends the project's own base imported from another file
(`class Screen extends AppComponent`) is invisible to every rule until that base is listed in
`componentBases` or `storeBases` (`settings.carburetor` in the lint config, or `.carburetorrc.json`).
This rule reports such a class once, at its `extends` clause, when its body plainly uses the engine:
it calls `useCarburetor`, `useComputed`, `useResource`, `suspendResource`, `useEffect`,
`useStoreEffect` or `useEvent` on `this`, declares `useEffects`/`unUseEffects`, or uses `this.draft` or
`this.emitUpdate`. The message names the list to add the base to. A base declared in the same file, a
built-in base and a listed one are never reported. It is `warn` in the recommended preset.

## House-style rules (optional, off by default)

The five rules below are optional house-style rules native to the Rust binary; their JavaScript
implementations no longer exist, so the plugin runs them through the same native bridge as every
other rule. All five are `off` in the recommended preset: a project turns on the ones it wants.
They are configured in `.carburetorrc.json` entries of the form `["warn", {…}]` on the CLI, and the
same entries work in a plugin host: the bridge hands a rule's own options to the native run. The
older form still works too — `settings.carburetor.ruleOptions`, keyed by the bare rule name without
the `carburetor/` prefix — and a rule's own entry wins over it for the same rule. `max-render-depth`
takes its `max` the same way. Rules given different options per directory (through `overrides`)
get one native run per distinct set:

```json
{
  "rules": {
    "carburetor/no-parent-import": ["error", {"roots": [{"path": "lib/src", "prefix": "@/"}]}]
  }
}
```

### `max-line-length`

Reports any source line longer than the limit. Options and defaults: `code` `120`, `tabWidth` `4`,
`ignoreUrls` `false`, `ignorePattern` (unset), `ignoreStrings` `true` (deliberately unlike the
common default: long string literals are data, not logic), `ignoreTemplateLiterals` `false`.

`ignorePattern` uses the syntax of the Rust `regex` crate: JavaScript-only constructs such as
lookahead, lookbehind, and backreferences are not supported, and a pattern invalid for that
syntax is a configuration error.

```json
{"rules": {"carburetor/max-line-length": ["warn", {"code": 100}]}}
```

### `no-blank-line-after-tsdoc`

Reports a blank line between a TSDoc block and the declaration it documents, where the block stops
reading as that declaration's documentation. No options.

### `no-parent-import`

Reports a `../`-relative import that resolves out of a configured source root, with the aliased
form as a fix. Options: `roots`, default `[]` — an array of `{path, prefix}` pairs naming where a
source tree starts and the alias that reaches into it. An upward import has no aliased form to
offer without a root, so the rule cannot be switched on without one: the native CLI rejects the
config, and the plugin reports once per run that the rule checks nothing.

```json
{"rules": {"carburetor/no-parent-import": ["warn", {"roots": [{"path": "lib/src", "prefix": "@/"}]}]}}
```

### `require-tsdoc`

Requires a `/** */` TSDoc block with a non-empty summary of at most `maxLines` lines on functions,
class methods, function-valued members and exported `const` functions. Options and defaults:
`maxLines` `3`, `access` `"all"` (or `"public"` to excuse private and protected members),
`allowOverloads` `true`, `allowInheritdoc` `true`, `allowTrivialAccessors` `false`,
`requireParamDocs` `false` (every parameter beyond a lone one needs a `@param` tag with a
description), `requireFieldDocs` `false` (plain class fields need the doc a function gets).

```json
{"rules": {"carburetor/require-tsdoc": ["warn", {"requireParamDocs": true, "requireFieldDocs": true}]}}
```

### `tsdoc-blank-line-before-tags`

Requires exactly one blank line between a TSDoc description and its first block tag, so the summary
paragraph stays visually separate from the tags. No options.
