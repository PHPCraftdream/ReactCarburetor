# Lint rules

The rules ship with the package as `react-carburetor/lint`. This page is the reference by rule
name; [hazards.md](hazards.md) is the same material organised by mistake, with the code that
triggers each one, why it is silent at runtime, and where the rule can be wrong.

The recommended rules protect carburetor logic and allocation hygiene: missed writes, abandoned
subscriptions, dropped cleanup, and functions rebuilt on every call. A separately enabled
`no-hooks` preset adds a component-architecture policy. The repository's unpublished house-style
plugin (import direction, line length, documentation) remains separate from both.

## Setup

**oxlint** — one line, and the plugin travels next to the preset:

```json
{
  "extends": ["./node_modules/react-carburetor/dist/lint/recommended.oxlintrc.json"]
}
```

**ESLint v9+** — spread the shareable config. `@typescript-eslint/parser` must be installed in
lint tooling; this config includes TS/TSX parsing.

```js
import tsParser from '@typescript-eslint/parser';
import carburetor from 'react-carburetor/lint';

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
  "extends": ["./node_modules/react-carburetor/dist/lint/recommended.oxlintrc.json"],
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
    "./node_modules/react-carburetor/dist/lint/recommended.oxlintrc.json",
    "./node_modules/react-carburetor/dist/lint/no-hooks.oxlintrc.json"
  ]
}
```

The JSON is also exported as `react-carburetor/lint/no-hooks.oxlintrc.json`. ESLint v9+ uses the
same policy through the plugin's shareable config:

```js
import tsParser from '@typescript-eslint/parser';
import carburetor from 'react-carburetor/lint';

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

This rule has no options or automatic conversion: changing component ownership requires a design
decision. Local forwarding follows at most eight alias links. Dynamic property names and
cross-module wrapper implementations are not inferred. It enforces a static architecture boundary,
not a proof of zero allocations: React still allocates, and a hook-free component can allocate in
its own render. Measure GC and completed-render costs.


## The rules

`error` means the mistake silently loses an update, a subscription or a re-render. `warn` means the
rule rests on a heuristic you have to judge. `off` means the rule contradicts a correct pattern
until your project changes shape.

| Rule | Level | Catches | Hazard |
|------|-------|---------|--------|
| `no-async-effect` | error | An `async` effect body, whose returned promise is taken for a cleanup and dropped | [H14](hazards.md) |
| `no-async-transaction` | error | An `async` body given to `transaction()` (a value import from `react-carburetor`) or `this.update()`, which closes the batch at the first `await` | [H17](hazards.md) |
| `no-computed-get-in-computed` | error | A computed reading a source with `get()`/`getData()` instead of its reader, so it registers no dependency and never invalidates | [H3](hazards.md) |
| `no-computed-get-in-render` | error | A computed read with `get()` in render, which registers no subscription | [H2](hazards.md) |
| `no-direct-data-write` | warn | A store writing to `this.data`, which records no path and invalidates everything | [H7](hazards.md) |
| `no-duplicate-effect-name` | error | Two `this.useEffect` calls under one name, where the second overwrites the first one's cleanup | [H15](hazards.md) |
| `no-escaping-tracked-data` | warn | Tracked data stored on the component or captured by a function that runs after the render | [H5](hazards.md) |
| `no-external-data-mutation` | error | A write through `getData()`, which notifies nobody and mutates shared snapshots | [H8](hazards.md) |
| `no-function-in-render` | warn | A function built in a component's render for a DOM-element attribute or as a render-body local — declare a method with `@bind` or move a per-item handler into a child | [H31](hazards.md) |
| `no-get-data-in-render` | error | `getData()` in render, so the component never subscribes and freezes | [H1](hazards.md) |
| `no-handler-created-in-render` | warn | A handler built in render and passed to a child, which defeats the props gate | [H21](hazards.md) |
| `no-lifecycle-class-property` | error | A lifecycle method declared as a class property, shadowing the base implementation | [H13](hazards.md) |
| `no-module-level-store` | off | A store created once per module, which a server shares across requests | [H18](hazards.md) |
| `no-react-hooks-in-components` | off | React `use`/`useX` calls in components when the optional hook-free policy is enabled | [Optional policy](#hook-free-components-optional) |
| `no-store-write-in-render` | error | A write to a store while rendering, which notifies subscribers mid-render | [H11](hazards.md) |
| `no-tracked-data-mutation` | error | A write to data from `useCarburetor`, which throws | [H9](hazards.md) |
| `no-untrackable-draft-mutation` | warn | An in-place change to a `Map`, `Set` or `Date` through `draft`, which costs all path precision | [H10](hazards.md) |
| `no-untrackable-store-data` | warn | `Map`, `Set` or `Date` in a store's data, which tracking and `snapshot()` both pass over | [H19](hazards.md) |
| `no-use-carburetor-outside-render` | error | `useCarburetor`/`useComputed` outside render, where they establish no subscription | [H4](hazards.md) |
| `require-bind-for-passed-method` | error | A component method passed as a value without `@bind`, losing its receiver | [H22](hazards.md) |
| `require-effect-deps` | warn | A prop or piece of state read by an effect but missing from its dependencies | [H16](hazards.md) |
| `require-emit-after-draft-write` | error | A method that writes through `draft` and never publishes | [H6](hazards.md) |
| `require-method-for-closure` | warn | A closure inside a class member that depends only on the class, rebuilt on every call of the member — declare it as a method | [H29](hazards.md) |
| `require-module-function` | warn | A closure or member that uses nothing from the class, rebuilt per call or per instance — declare it at module level | [H30](hazards.md) |
| `require-subscription-disposal` | warn | A subscription whose id is discarded, so it can never be released | [H20](hazards.md) |
| `require-super-in-lifecycle` | error | A lifecycle override that skips `super`, disabling effects, cleanup or the props gate | [H12](hazards.md) |

## Fixed recognition and severity-only configuration

The preset's recognitions are fixed and syntactic:

| Kind | Recognised names |
|------|------------------|
| Store | `Carburetor`, `ResourceCarburetor` |
| Component | `AntiHookComponent`, `ScopedAntiHookComponent` |
| Render | `render` |

Custom components should directly extend a recognised component base; recognition is not generally
transitive. Recognition names cannot be configured. Configuration accepts severity only: `error`,
`warn` or `off`. Legacy `[severity, options]` payloads may remain stored in host configuration, but
native rules do not consume options. Suppress reports with `// carburetor-disable-next-line <rule>`
or `// carburetor-disable <rule>`; either directive without a rule list silences all carburetor
rules.

## One rule replaces a built-in

`typescript/unbound-method`, and `@typescript-eslint/unbound-method`, cannot see the `@bind`
decorator and report correct usage as an error. Switch it off and keep
`carburetor/require-bind-for-passed-method`, which knows about the decorator and also reports the
opposite mistake — a method passed as a value *without* it.
