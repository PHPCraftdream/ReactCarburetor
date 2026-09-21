# Contributing

Thanks for taking the time. This project has a narrow design thesis, so the most useful
contributions are the ones that sharpen it rather than widen it.

## Design rules

- **No hooks in the public API.** State lives outside the tree; components are classes.
  A change that requires consumers to write hooks is out of scope.
- **Never create an unnecessary re-render.** Precision beats smoothing. If something
  re-renders too often, fix the invalidation, don't add a delay.
- **Render stays pure.** Subscriptions are established in the commit phase, never during render.
- **Never miss an update.** When the changed paths cannot be known, fall back to invalidating
  everything rather than guessing.
- **Diagnostics are development-only and strippable.** Guard them with a literal
  `process.env.NODE_ENV !== 'production'` comparison and put the message *inside* that guard,
  never in a method of its own — a class member survives into a production bundle whatever the
  branch does. Report through `diagnostics.report` so users can switch them off.
- **Handlers use `@bind`, lifecycle methods stay methods.** A class property shadows the
  prototype, which breaks `super` and has silently disabled effects before. `typescript/unbound-method`
  cannot see the decorator and is therefore off in `.oxlintrc.json`; `require-bind-for-passed-method`
  in the lint plugin replaces it (see `docs/hazards.md`, H22).
- **Optimize on measurements.** Performance work starts with a benchmark under
  `benchmarks/`, run against the built output, and the numbers go into the code comment or the
  README. Benchmarks stay out of the test suite so the test run stays fast.

## Project layout

Two structural rules keep the tree navigable:

- **One export per file.** A file carries a single class, function, constant or enum, and is
  named after it. The exceptions are `Models.ts` files (and the `Models/` folder), which group
  related types and interfaces, and `index.ts` barrels, which only re-export. Type-only files
  are always named `Models.ts` so the rule can be checked mechanically.
- **Enums instead of string unions.** A closed set of values is an enum in `Models/Enums/`
  (`EResourceStatus`, `EDevToolsAction`), not a union of string literals, and never a bare
  string literal in a comparison — a typo should be a compile error, not a branch that never
  runs.
- **At most seven entries per directory.** When a folder outgrows that, its contents are
  regrouped into subfolders by meaning rather than left as a flat list.

Both rules are checked by `npm run check:layout`, which runs in CI — they are enforced rather than
remembered.

Singletons live next to their class in a file suffixed with `Instance`
(`SyncUpdateScheduler.ts` and `SyncUpdateSchedulerInstance.ts`) — two files differing only
in the first letter's case would collide on case-insensitive filesystems.

The engine is grouped as `Models/` (types), `Store/` (the carburetor and its machinery:
paths, tracking proxies, transactions, schedulers), `Derived/` (computed values),
`Resource/` (async state), `Component/` (React integration) and `Tooling/` (devtools,
persistence, history, test helpers). The optional hooks bridge lives in `lib/src/Interop`.

## The lint plugins

There are two, and the line between them is what a rule is *about*.

`plugin/src` — **shipped**, as `react-carburetor/lint`. These rules are about the safety of
carburetor logic: a write nobody hears, a component that never subscribes, an effect whose cleanup
is dropped. Those are the library's business wherever the code lives, so consumers get them. They
are catalogued in `docs/hazards.md` and listed in `docs/rules.md`.

`plugin/internal` — **not shipped**, loaded from source by `.oxlintrc.json` only. These rules are
about how this repository is written: import direction, and the style rules that follow. That is
house taste, and shipping it would impose this project's conventions on someone who asked for a
state engine. A build only ever starts from `plugin/src`, so nothing internal can reach `dist` by
accident — and a test asserts the bundle does not contain it.

The internal rules, and the two decisions inside them that are not obvious:

| Rule | What it asks for |
|------|------------------|
| `no-parent-import` | no `../` — imports go down from `@`, and `--fix` rewrites the offenders |
| `max-line-length` | 120 columns, a tab counting to its tab stop |
| `require-tsdoc` | a `/** */` block on every function, method, function-valued property and exported `const` function |
| `no-blank-line-after-tsdoc` | nothing between the closing `*/` and the declaration; `--fix` removes it |

`max-line-length` **ignores string literals by default**, unlike `eslint/max-len`. The demo's long
lines are all `className` attributes holding Tailwind class lists and one SVG path; wrapping them
would make the classes ungreppable and inflate every diff that touches them, and the rule is meant
to police logic lines rather than class lists.

`require-tsdoc` measures **only the summary** against `maxLines` — the lines before the first blank
one. Everything after that blank line is the rationale, which this repository wants written at
length: "why, not what" produces paragraphs, and a limit on the whole comment would be a limit on
explaining anything. It is off for `__tests__`, where a test's name is its documentation.

Both plugins share the types and AST helpers under `plugin/src`, reached through the `#src/*` map in
`plugin/package.json`. A rule that fixes something puts the fix in the rule rather than in a script:
`no-parent-import` rewrites `../../Models/Paths` to `@/Carburetor/Models/Paths` under
`oxlint --fix`, which is why its tests assert the rewritten source and not just the report. A
one-off script would have to be written again next time, and would never run on code that is still
being typed.

One implementation serves both hosts, because oxlint's JS plugin API is ESLint's: this repository
loads both plugins through `jsPlugins` in `.oxlintrc.json`, and a consumer on ESLint v9 imports the
shipped one into a flat config.

Adding a rule: one file per rule next to the others, registered in `plugin/src/index.mts`, and
tested twice — with oxlint's `RuleTester` (from `oxlint/plugins-dev`, so no extra dependency) for
the rule's logic, and through the real binary over a fixture in `plugin/__fixtures__` for the
host path. The second test exists because `RuleTester` drives `create` directly and cannot show
that oxlint loads the plugin at all.

Three host constraints are easy to trip over, all established by probing rather than by reading:

- **`jsPlugins` paths resolve relative to the config file**, not to the working directory. The same
  is true of a path in `extends`, and of the `jsPlugins` inside an extended config — which is what
  lets a consumer point one `extends` line at `dist/lint/recommended.oxlintrc.json` and get the
  bundled plugin next to it.
- **Type-only imports must be written `import type`.** oxlint loads the plugin through Node,
  which strips types but does not remove a value import of something that only exists as a type,
  so a plain `import {IRule}` makes the whole plugin fail to load. `verbatimModuleSyntax` in
  `plugin/tsconfig.json` turns that into a compile error instead of a runtime one.
- **Linting this repository needs a Node that strips types**, because `.oxlintrc.json` loads the
  plugin from `plugin/src` rather than from a build — so a rule edit takes effect immediately
  instead of after a rebuild. That means Node 22.18+ or 24, which is why CI runs 24. Consumers are
  unaffected: they get the compiled bundle.

The published plugin is one bundled file per format under `dist/lint`, because the sources import
each other through the `#src/*` map in `plugin/package.json`, which only resolves inside this
repository. `plugin/src/recommended.mts` is the single source of severities, and
`__tests__/Plugin/packaging.test.ts` pins the JSON preset and the flat config against it, then runs
both hosts against the built bundle the way a consumer would.

The oxlint documentation warns that a JS plugin costs noticeably more than a native rule, so the
cost was measured on this repository rather than guessed (best of four runs each):

| Configuration                      | Time   |
|------------------------------------|--------|
| native rules only                  | 315 ms |
| plugin loaded, all 22 rules off    | 437 ms |
| plugin active                      | 585 ms |

So +122 ms is fixed — starting Node, stripping the types, loading the plugin — and +148 ms is the
22 rules actually running over the whole tree. Under 0.6 s in total, which is why they stay on in
the default lint run. Re-measure before adding a rule that walks much more than a few node types.

oxlint has no native plugin API, which is worth writing down so nobody re-investigates: there are
exactly two mechanisms — built-in plugins compiled into the binary, and `jsPlugins`. No dylib, no
wasm, and the npm package installs a prebuilt platform binary. That is by design, since Rust has no
stable ABI and oxc's AST types move between releases.

So the native path is a **binary of our own**, in `native/`, called by the plugin once per lint run
rather than compiled into the linter. It is 20 ms over this whole tree against the 270 ms the
JavaScript rule layer used to cost — see `native/README.md` for the measurements and for why "once
per run" is achievable in ESLint's multithreaded mode. All 22 rules under `plugin/src/Rules/` are
now this bridge: each one is `nativeRule(id, description)`
(`plugin/src/Utils/Native/nativeRule.mts`), a few lines that read the one shared result and report
whatever belongs to that rule's own id. Detection lives only in `native/src/rules/` — one
implementation, not two — and suppression comments, editor diagnostics and per-rule severity keep
working because the host still owns every `context.report()` call; the bridge never decides
severity or filters by config, it only tells each rule which of its own findings exist.

`plugin/src/Utils/Native/nativeBridge.mts` is the "once" part: a module-scope cache means the
first rule any file asks already answers for every rule and every file after it, within one
process. ESLint's `--concurrency` workers are separate JS engines with separate module state, so
the cross-worker half goes through the filesystem instead — the first worker to create a lock file
in the OS temp directory runs the binary and writes a result file; the rest wait for that file to
appear, sleeping via `Atomics.wait` because a rule's visitor cannot `await`. The bridge always
forces every rule to `error` when it calls the binary, regardless of native's own defaults or this
project's config: severity is the host's decision, made when it chooses whether to call a rule's
`create()` at all, not native's, and a rule OFF in native's defaults but ON in a consumer's config
must still be computed for that consumer to see it.

Reporting through both hosts from one synthetic node needed two things neither host's docs led
with, found by actually running each one over the built bundle: oxlint requires `range` on the
node, and ESLint separately requires `loc` — it never derives one for a node its own parser did not
produce, so a report with `range` alone crashes ESLint's formatter while working fine in oxlint. The
synthetic node in `nativeRule.mts` carries both. The other trap: native walks from `.`, so its
`file` field carries a leading `./` that `path.relative()` never produces — comparing the two
without stripping it silently matches nothing and reports nothing, which looks exactly like a
clean lint run.

`resolveBinary()` finds the binary a workspace `cargo build` produces by walking upward from its
own file until it finds `native/target/{release,debug}`, rather than a fixed number of `..`
segments: this file sits four directories under the repo root as source
(`plugin/src/Utils/Native/`) but one under it once bundled (`dist/lint/`), and a fixed depth is
right for only one of those two shapes.

The one lever that does exist: pointing `jsPlugins` at the built bundle instead of the `.mts`
sources measures 475 ms against 558 ms — 82 ms saved by skipping type stripping and thirty module
resolutions. It is not taken, because CI would then lint with the bundle, which deliberately does
not contain the internal plugin; building a second, unpublished bundle to get those 82 ms back costs
more machinery than it saves.

A rule that reports code the repository writes on purpose — a regression test that deliberately
does the wrong thing — is silenced with a line comment explaining why, never by weakening the
rule.

## Getting started

```bash
npm install
npm run build        # Rslib: bundleless library, bundled lint plugin, declarations via tsgo
npm run typecheck    # TypeScript 7, library and plugin
npm run lint         # oxlint: native rules, type-aware rules, and this project's own 22
npm run check:layout # the two structural rules above
npm test             # Rstest + @testing-library/react
npm run test:rules   # just the lint rules, when that is what you changed
```

The demo app has its own package:

```bash
cd lib && npm install && npm start
```

Note that the repository does not commit lockfiles, so use `npm install` rather than `npm ci`.

## Pull requests

- Keep the four commands above green. A failing or flaky test is fixed in the same change,
  not deferred.
- Add a regression test for every bug fix. Several of the subtle bugs in this codebase were
  only visible through tests that render real DOM, so prefer a test that exercises the
  component path over a unit test of an internal helper.
- Comments and identifiers are in English, and comments explain *why*, not *what*.
- Don't bump the package version or dependency versions as part of a feature change.

## Licensing of contributions

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in this project by you, as defined in the Apache-2.0 license, shall be dual
licensed as MIT OR Apache-2.0, without any additional terms or conditions.
