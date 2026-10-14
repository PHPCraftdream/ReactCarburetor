# Lint usage

React Carburetor ships 26 lint rules that catch silent mistakes in consumer code: missed writes,
abandoned subscriptions, dropped cleanup, tracked data escaping a store, and functions rebuilt on
every call. The same rules run three ways — as an oxlint plugin preset, as ESLint shareable
configs, or through a standalone binary.

## oxlint

One line in `.oxlintrc.json`; the plugin file (`index.mjs`) travels next to the preset inside the
package and is loaded through the preset's `jsPlugins` entry:

```json
{
  "extends": ["react-carburetor/lint/recommended.oxlintrc.json"]
}
```

The direct path works too, and is what [rules.md](../rules.md) shows:

```json
{
  "extends": ["./node_modules/react-carburetor/dist/lint/recommended.oxlintrc.json"]
}
```

The optional hook-free preset adds a component-architecture policy on top of recommended. It sets
`carburetor/no-react-hooks-in-components: 'error'`; add it as a second extends entry:

```json
{
  "extends": [
    "react-carburetor/lint/recommended.oxlintrc.json",
    "react-carburetor/lint/no-hooks.oxlintrc.json"
  ]
}
```

## ESLint flat config

For `eslint.config.ts` or `eslint.config.mjs`, spread the shareable configs. `@typescript-eslint/parser`
must be installed in lint tooling:

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

To check the config itself against the shipped declarations, type it with the same imports the
plugin exposes:

<!-- example:compile -->
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

// Each rule carries its own description, for a generated rule list or editor tooling.
const describeRule = (rule: ICarburetorRule): string => rule.meta?.docs?.description ?? '';
const catalogue = Object.entries(plugin.rules).map(([id, rule]) => `${id}: ${describeRule(rule)}`);
```

The configs array can be exported directly from `eslint.config.ts`; the annotations above simply
prove the shapes match before it ships.

## Standalone CLI

`carburetor-lint` runs the native rules without a host linter:

```shell
pnpm add -D carburetor-lint
```

It ships one compiled binary per platform through `optionalDependencies`, so nothing is compiled at
install time.

```shell
npx carburetor-lint src                 # report
npx carburetor-lint --fix src           # apply the fixes rules can make
npx carburetor-lint --fix-dry-run src   # preview them
npx carburetor-lint --format=json src   # machine-readable output
```

`--config` defaults to `./.carburetorrc.json` when that file exists. Exit codes are `0` when clean,
`1` for lint problems, and `2` for missing paths or a launcher/linter failure. `--fix` and
`--fix-dry-run` are mutually exclusive. Configuration accepts severity strings only — `error`,
`warn`, or `off`; the native rules do not consume rule options.

## .carburetorrc.json

Configuration is JSON with two top-level keys, `rules` and `ignore`; anything else is rejected
rather than ignored. Rule names may be bare or carry the `carburetor/` prefix:

```json
{
  "rules": {
    "carburetor/no-escaping-tracked-data": "off",
    "carburetor/no-module-level-store": "error"
  }
}
```

## Suppressions

A single line is silenced with `// carburetor-disable-next-line <rule>` placed directly above it;
`// carburetor-disable <rule>` silences a rule for the whole file. Without a rule list either
directive silences all carburetor rules — always name the rule and say why.

<!-- example:compile -->
```ts
import {AntiHookComponent} from 'react-carburetor';

class Counter extends AntiHookComponent {
    value = 0;

    // carburetor-disable-next-line carburetor/require-method-for-closure
    increment = () => { this.value += 1; };
}
```

The native pass also honours the oxlint spellings `oxlint-disable-next-line` and `oxlint-disable`;
under the ESLint host, `eslint-disable` comments work as ESLint itself interprets them.

Rule-by-rule reference: [rules.md](../rules.md); symptoms: [troubleshooting.md](../troubleshooting.md).

## Functions built in render

A function created while a component renders — an arrow in a DOM-element attribute, a `.bind(...)`, a render-body local — is a new object on every render. Handlers belong on the instance: declare a method with `@bind`; for a per-item handler, move the row into a child component that receives the id.

<!-- example:compile -->
```tsx
import {AntiHookComponent, bind} from 'react-carburetor';

interface Item {
    id: string;
    name: string;
}

declare function pick(id: string): void;

// Wrong: a fresh handler on every render.
export class BadList extends AntiHookComponent<{items: Item[]}> {
    public render() {
        return <ul>{this.props.items.map((item) =>
            <li key={item.id} onClick={() => pick(item.id)}>{item.name}</li>)}
        </ul>;
    }
}

// Right: one bound method per instance; the row owns its handler.
class ItemRow extends AntiHookComponent<{item: Item}> {
    @bind
    private onClick(): void {
        pick(this.props.item.id);
    }

    public render() {
        return <li onClick={this.onClick}>{this.props.item.name}</li>;
    }
}

export class ItemList extends AntiHookComponent<{items: Item[]}> {
    public render() {
        return <ul>{this.props.items.map((item) => <ItemRow key={item.id} item={item} />)}</ul>;
    }
}
```
