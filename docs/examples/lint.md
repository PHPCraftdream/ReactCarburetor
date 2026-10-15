# Lint usage

React Carburetor ships 27 registry rules: 26 catalogue rules plus the optional `no-react-hooks-in-components` policy rule. Recommended includes rules at their configured severities; `no-module-level-store` and the hook policy default to off. The same rules run through oxlint, ESLint, or the standalone binary.

## oxlint

One line in `.oxlintrc.json`; the plugin file travels next to the preset inside the package:

```json
{
  "extends": ["react-carburetor/lint/recommended.oxlintrc.json"]
}
```

The direct path works too:

```json
{
  "extends": ["./node_modules/react-carburetor/dist/lint/recommended.oxlintrc.json"],
  "rules": {
    "carburetor/require-module-function": ["warn", {"scope": "classes"}]
  }
}
```

`require-module-function` accepts `scope: "all"` (default) or `"classes"`. The default analyzes clean nested functions throughout a file; `classes` limits nested-function findings to class bodies. Both retain eligible component-member analysis and cover clean callbacks in store classes. Unknown scope values or option keys are configuration errors.

The optional hook-free preset is separate. It enables `carburetor/no-react-hooks-in-components: 'error'`:

```json
{
  "extends": [
    "react-carburetor/lint/recommended.oxlintrc.json",
    "react-carburetor/lint/no-hooks.oxlintrc.json"
  ]
}
```

## ESLint flat config

For `eslint.config.ts` or `eslint.config.mjs`, spread the shareable configs. `@typescript-eslint/parser` must be installed in lint tooling:

<!-- example:file examples/api/tooling/eslint.config.js#doc -->
```js
import tsParser from '@typescript-eslint/parser';
import carburetor from 'react-carburetor/lint';

export default [
    {
        ...carburetor.configs.recommended,
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {parser: tsParser},
    },
    {
        ...carburetor.configs['no-hooks'],
    },
];
```

To check the config against the shipped declarations:

<!-- example:file examples/api/types/lint.ts#doc -->
```ts
import carburetor, {
    ICarburetorFlatConfig,
    ICarburetorPlugin,
    ICarburetorRule,
    TSeverity,
} from 'react-carburetor/lint';

const plugin: ICarburetorPlugin = carburetor;
const severity: TSeverity = 'error';
const configs: ICarburetorFlatConfig[] = [plugin.configs.recommended, plugin.configs['no-hooks']];
const describeRule = (rule: ICarburetorRule): string => rule.meta?.docs?.description ?? '';
const catalogue = Object.entries(plugin.rules).map(([id, rule]) => `${id}: ${describeRule(rule)}`);
```

## Standalone CLI

`carburetor-lint` runs native rules without a host linter:

```shell
pnpm add -D carburetor-lint
```

It ships a compiled binary per platform through `optionalDependencies`, so nothing is compiled at install time.

```shell
npx carburetor-lint src                 # report
npx carburetor-lint --fix src           # apply supported fixes
npx carburetor-lint --fix-dry-run src   # preview fixes
npx carburetor-lint --format=json src   # machine-readable output
```

`--config` defaults to `./.carburetorrc.json` when present. Exit codes are `0` (clean), `1` (findings), and `2` (missing paths or tool/config/CLI failure). `--fix` and `--fix-dry-run` are mutually exclusive.

## .carburetorrc.json

Configuration is JSON with `rules` and `ignore` top-level keys; anything else is rejected. Rule names may be bare or prefixed with `carburetor/`:

```json
{
  "rules": {
    "carburetor/no-escaping-tracked-data": "off",
    "carburetor/require-module-function": ["warn", {"scope": "classes"}]
  }
}
```

## Suppressions

A line is silenced with `// carburetor-disable-next-line <rule>` directly above it; `// carburetor-disable <rule>` silences the rule for a whole file. Without a rule list either directive silences all rules — name the rule and explain why.

<!-- example:file examples/api/types/suppressions.ts#doc -->
```ts
import {AntiHookComponent} from 'react-carburetor';

class Counter extends AntiHookComponent {
    value = 0;

    // Intentional anti-pattern for demonstrating a narrow suppression.
    // carburetor-disable-next-line carburetor/require-method-for-closure
    increment = () => { this.value += 1; };
}
```

The native pass also honours oxlint suppression spellings. ESLint disable comments work as ESLint interprets them.

## H31: functions built in render

Inline function callbacks passed to synchronous array methods in render are findings, even when they only create elements. Use a module-level function when no `this` is needed or a bound method when it is. A capturing `this.update` callback is H32; write directly to `this.draft` and publish with `emitUpdate()` (use `try/finally` if a mutation can throw). Clean update callbacks belong at module scope under H30.

<!-- example:file examples/wrong/no-function-in-render/List.expected.no-function-in-render.require-module-function.tsx#doc -->
```tsx
import {AntiHookComponent, bind} from 'react-carburetor';

interface Item { id: string; name: string }
const renderRow = (item: Item): React.ReactElement => <ItemRow key={item.id} item={item}/>;

declare function pick(id: string): void;

// Intentional anti-pattern: inline map callback and handler allocate during render.
export class BadList extends AntiHookComponent<{items: Item[]}> {
    public render() {
        return <ul>{this.props.items.map((item) =>
            <li key={item.id} onClick={() => pick(item.id)}>{item.name}</li>)}</ul>;
    }
}

class ItemRow extends AntiHookComponent<{item: Item}> {
    @bind
    private onClick(): void { pick(this.props.item.id); }

    public render() {
        return <li onClick={this.onClick}>{this.props.item.name}</li>;
    }
}

export class ItemList extends AntiHookComponent<{items: Item[]}> {
    public render() {
        return <ul>{this.props.items.map(renderRow)}</ul>;
    }
}
```

The map callback is a stable module-level reference. The row owns its event handler through a bound method. See [rules.md](../rules.md) and [hazards.md](../hazards.md).

## H32: capturing callbacks passed to `this.update`

A callback that captures a member parameter, local binding, or `this` allocates a closure each time the method runs. Write directly to `this.draft` and publish with `emitUpdate()`; use `try/finally` when a mutation may throw. A clean callback is H30 instead.

**Wrong**

<!-- example:file examples/wrong/no-closure-in-update/Counter.ts#doc -->
```ts
import {Carburetor} from 'react-carburetor';

interface CounterState { count: number; name: string }

class Counter extends Carburetor<CounterState> {
    public bump(step: number): void {
        this.update((draft) => {
            draft.count += step;
        });
    }
}
```

**Right**

<!-- example:file examples/api/types/update.ts#doc -->
```ts
import {Carburetor} from 'react-carburetor';

interface CounterState { count: number; name: string }
declare function normalizeName(name: string): string;

const increment = (draft: CounterState): void => { draft.count += 1; };

class Counter extends Carburetor<CounterState> {
    public bump(step: number): void {
        this.draft.count += step;
        this.emitUpdate();
    }

    public rename(name: string): void {
        try {
            this.draft.name = normalizeName(name);
        } finally {
            this.emitUpdate();
        }
    }

    public increment(): void {
        this.update(increment);
    }
}
```

A clean inline callback belongs at module scope under H30. `update` publishes in `finally`; direct draft writes should likewise publish in `finally` if an exception can follow a partial mutation.
