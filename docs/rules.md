# Lint rules

The rules ship with the package as `react-carburetor/lint`. This page is the reference by rule
name; [hazards.md](hazards.md) is the same material organised by mistake, with the code that
triggers each one, why it is silent at runtime, and where the rule can be wrong.

Everything shipped is about the safety of carburetor logic — a write nobody hears, a component that
never subscribes, an effect whose cleanup is dropped. The repository keeps a second, unpublished
plugin for its own house style (import direction, line length, documentation); those rules are not
in the package, because they are this project's taste rather than the library's semantics.

## Setup

**oxlint** — one line, and the plugin travels next to the preset:

```json
{
  "extends": ["./node_modules/react-carburetor/dist/lint/recommended.oxlintrc.json"]
}
```

**ESLint v9+** — spread the shareable config:

```js
import carburetor from 'react-carburetor/lint';

export default [
    {...carburetor.configs.recommended, files: ['src/**/*.{ts,tsx}']},
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

A single line is silenced with a disable comment — `// oxlint-disable-next-line carburetor/<rule>`
or `// eslint-disable-next-line carburetor/<rule>` — placed directly above the line that gets
reported, not above the enclosing declaration. A whole file takes
`/* oxlint-disable carburetor/<rule> */` as a comment of its own. When you silence a rule, say why:
this repository does it in a handful of tests whose entire purpose is to exercise the hazard, and
each one carries a sentence explaining that.

## The rules

`error` means the mistake silently loses an update, a subscription or a re-render. `warn` means the
rule rests on a heuristic you have to judge. `off` means the rule contradicts a correct pattern
until your project changes shape.

| Rule | Level | Catches | Hazard |
|------|-------|---------|--------|
| `no-async-effect` | error | An `async` effect body, whose returned promise is taken for a cleanup and dropped | [H14](hazards.md) |
| `no-async-transaction` | error | An `async` body given to `transaction()` or `update()`, which closes the batch at the first `await` | [H17](hazards.md) |
| `no-computed-get-in-computed` | error | A computed reading a source with `get()`/`getData()` instead of its reader, so it registers no dependency and never invalidates | [H3](hazards.md) |
| `no-computed-get-in-render` | error | A computed read with `get()` in render, which registers no subscription | [H2](hazards.md) |
| `no-direct-data-write` | warn | A store writing to `this.data`, which records no path and invalidates everything | [H7](hazards.md) |
| `no-duplicate-effect-name` | error | Two effects under one name, where the second overwrites the first one's cleanup | [H15](hazards.md) |
| `no-escaping-tracked-data` | warn | Tracked data stored on the component or captured by a function that runs after the render | [H5](hazards.md) |
| `no-external-data-mutation` | error | A write through `getData()`, which notifies nobody and mutates shared snapshots | [H8](hazards.md) |
| `no-get-data-in-render` | error | `getData()` in render, so the component never subscribes and freezes | [H1](hazards.md) |
| `no-handler-created-in-render` | warn | A handler built in render and passed to a child, which defeats the props gate | [H21](hazards.md) |
| `no-lifecycle-class-property` | error | A lifecycle method declared as a class property, shadowing the base implementation | [H13](hazards.md) |
| `no-module-level-store` | off | A store created once per module, which a server shares across requests | [H18](hazards.md) |
| `no-store-write-in-render` | error | A write to a store while rendering, which notifies subscribers mid-render | [H11](hazards.md) |
| `no-tracked-data-mutation` | error | A write to data from `useCarburetor`, which throws — or does nothing once a cast hides it | [H9](hazards.md) |
| `no-untrackable-draft-mutation` | warn | An in-place change to a `Map`, `Set` or `Date` through `draft`, which costs all path precision | [H10](hazards.md) |
| `no-untrackable-store-data` | warn | `Map`, `Set` or `Date` in a store's data, which tracking and `snapshot()` both pass over | [H19](hazards.md) |
| `no-use-carburetor-outside-render` | error | `useCarburetor`/`useComputed` outside render, where they establish no subscription | [H4](hazards.md) |
| `require-bind-for-passed-method` | error | A component method passed as a value without `@bind`, losing its receiver | [H22](hazards.md) |
| `require-effect-deps` | warn | A prop or piece of state read by an effect but missing from its dependencies | [H16](hazards.md) |
| `require-emit-after-draft-write` | error | A method that writes through `draft` and never publishes | [H6](hazards.md) |
| `require-method-for-closure` | warn | A closure inside a class member that depends only on the class, rebuilt on every call of the member — declare it as a method | [H28](hazards.md) |
| `require-module-function` | warn | A closure or member that uses nothing from the class, rebuilt per call or per instance — declare it at module level | [H29](hazards.md) |
| `require-subscription-disposal` | warn | A subscription whose id is discarded, so it can never be released | [H20](hazards.md) |
| `require-super-in-lifecycle` | error | A lifecycle override that skips `super`, disabling effects, cleanup or the props gate | [H12](hazards.md) |

## Options

Detection is syntactic — a JS plugin gets no type checker — so a project whose classes the rules
cannot recognise by name has to name them. Every rule accepts:

| Option | Default | Purpose |
|--------|---------|---------|
| `componentBases` | `["AntiHookComponent", "ScopedAntiHookComponent"]` | Base classes that make a class a carburetor component |
| `carburetorBases` | `["Carburetor", "ResourceCarburetor"]` | Base classes that make a class a store |
| `renderMethods` | `["render"]` | Methods to treat as render, for components with render helpers |

Rules with an option of their own:

| Rule | Option | Purpose |
|------|--------|---------|
| `require-emit-after-draft-write` | `deferredEmitMethods` | Methods that deliberately leave publishing to their caller. `preEmit`, and anything it calls, is already exempt |
| `no-untrackable-draft-mutation` | `mutatingMethods` | The method names treated as in-place changes |
| `no-untrackable-store-data` | `allowedTypes` | Untrackable types you accept in store data, `Date` being the usual one |
| `no-store-write-in-render` | `storeNames` | Stores a component writes to without ever reading them |
| `no-handler-created-in-render` | `ignoreComponents` | Components cheap enough that a fresh handler does not matter |
| `no-module-level-store` | `storeConstructors` | Store constructors this rule cannot recognise by name |

```json
{
  "rules": {
    "carburetor/no-get-data-in-render": ["error", {"renderMethods": ["render", "renderRow"]}],
    "carburetor/no-untrackable-store-data": ["warn", {"allowedTypes": ["Date"]}]
  }
}
```

## One rule replaces a built-in

`typescript/unbound-method`, and `@typescript-eslint/unbound-method`, cannot see the `@bind`
decorator and report correct usage as an error. Switch it off and keep
`carburetor/require-bind-for-passed-method`, which knows about the decorator and also reports the
opposite mistake — a method passed as a value *without* it.
