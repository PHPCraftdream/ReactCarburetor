# Contributing

Thanks for taking the time. This project has a narrow design thesis, so the most useful
contributions are the ones that sharpen it rather than widen it.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report possible security
vulnerabilities privately using the [security policy](SECURITY.md), not a public issue.

## Design rules

- **No hooks in the core API.** State lives outside the tree; components are classes.
  An optional hooks interop bridge exists, but a change that requires core consumers to
  write hooks is out of scope.
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
- **Optimize on measurements.** Performance work starts with a scenario in `perf/`, measured
  with `npm run bench` against the built output, and the numbers go into the code comment or the
  README. Every improvement keeps an entry in `perf/gates/`, validated both ways — failing on the
  pre-improvement build, passing on the current one (see `perf/README.md`). Benchmarks stay out of
  the test suite so the test run stays fast.

## Project layout

Three structural rules keep the tree navigable:

- **One export per file.** A file carries a single class, function, constant or enum, and is
  named after it. The exceptions are `Models.ts` files (and the `Models/` folder), which group
  related types and interfaces, `index.ts` barrels, which only re-export, and test-only
  `support`/`fixtures`/`helpers` files, which share setup across test modules. Type-only files are always
  named `Models.ts` so the rule can be checked mechanically.
- **Enums instead of string unions.** A closed set of values is an enum in `Models/Enums/`
  (`EResourceStatus`, `EDevToolsAction`), not a union of string literals, and never a bare
  string literal in a comparison — a typo should be a compile error, not a branch that never
  runs.
- **At most seven entries per directory.** When a folder outgrows that, its contents are
  regrouped into subfolders by meaning rather than left as a flat list.
- **At most 600 physical lines per code file.** This includes tests and native Rust code; split
  large files by responsibility. Documentation, dependencies and generated output are excluded.

All three rules are checked by `npm run check:layout`, which runs in CI — they are enforced rather than
remembered.

Singletons live next to their class in a file suffixed with `Instance`
(`SyncUpdateScheduler.ts` and `SyncUpdateSchedulerInstance.ts`) — two files differing only
in the first letter's case would collide on case-insensitive filesystems.

The engine is grouped as `Models/` (types), `Store/` (the carburetor and its machinery:
paths, tracking proxies, transactions, schedulers), `Derived/` (computed values),
`Resource/` (async state), `Component/` (React integration) and `Tooling/` (devtools,
persistence, history, test helpers). The optional hooks bridge lives in `lib/src/Interop`.

## Documentation examples and native lint rules

The registry contains 27 rules: 26 catalogue rules plus the optional `no-react-hooks-in-components` policy. `no-module-level-store` is off in recommended. `require-module-function` accepts `scope: "all"` (default) or `"classes"`; H31 covers inline synchronous array callbacks in render, and H32 flags capturing `this.update` callbacks in recognized store classes. Positive documentation examples should use module-level callbacks when they need no surrounding state, bound methods when they need `this`, and direct draft writes plus `emitUpdate()` instead of capturing update callbacks.

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
| `tsdoc-blank-line-before-tags` | exactly one blank ` *` line between a doc's description and its first block tag (`@param`, `@returns`…); `--fix` inserts or collapses to one |

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

Adding an internal style rule: one file per rule next to the others, registered in
`plugin/internal/index.mts`, and tested with oxlint's `RuleTester` (from `oxlint/plugins-dev`).
`RuleTester` applies to these private source-style rules only. Shipped native rules are covered by
native unit/conformance/CLI tests and bridge saved-file host tests; bridge source text comes from
saved files scanned by the native binary, not from the `RuleTester` buffer.

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
rather than compiled into the linter. An earlier 22-rule benchmark recorded 20 ms natively against
270 ms for the JavaScript rule layer — see `native/README.md` for current measurements and why "once
per run" is achievable in ESLint's multithreaded mode. `plugin/src/Rules/` contains 27 bridges, registered against the native registry.
Each bridge is `nativeRule(id, description)` in
`plugin/src/Utils/Native/nativeRule.mts`, a few lines that read the one shared result and report
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

The library's published plugin is the shipped surface: the native binary recognises fixed class
bases (`AntiHookComponent`, `ScopedAntiHookComponent`, `Carburetor`, and `ResourceCarburetor`) and
the fixed method name `render`. Custom component classes should directly extend one of the two
component bases; custom intermediate classes are not generally recognised. Recognition names
cannot be configured; only rule severity can be set to `error`, `warn` or `off`.

## Documentation examples

Runnable examples live under `examples/` and are checked as consumer code against source aliases for `react-carburetor`, `react-carburetor/interop`, and `react-carburetor/lint`. Add practical, self-contained recipes that demonstrate actual API usage; do not add lists of export names merely to satisfy coverage. Proper examples are included in `npm run typecheck` and linted under normal allocation rules.

In Markdown, every `ts`/`tsx`/`js`/`jsx` block in README and docs is generated from `examples/`: place `<!-- example:file examples/path/File.tsx -->` directly before the fence, or append `#name` (`examples/path/File.tsx#name`) to include a named region delimited by `// #region name` and `// #endregion name`. Keep generated prose synchronized with `npm run docs:build`; `npm run docs:check` is strict — it reports stale copies, invalid markers, and any unmarked target-language fence without rewriting files. There is no allowlist: a code fence without a marker is an error.

Examples that intentionally demonstrate a violation belong only in `examples/wrong/<rule>/`; directories starting with `_` (`_unlinted/<hazard-id>/`) hold wrong examples the native linter cannot catch and are typechecked through `scripts/tools/tsconfig.examples-unlinted.json`. Tests import example sources directly to assert their behavior and diagnostics. The native example suite requires each such file to yield exactly its expected finding and no unrelated diagnostics; positive examples must remain clean under default native rules. Never suppress allocation rules for proper examples to make them pass. The focused checks are `npx tsc --noEmit -p examples/tsconfig.json` and `node node_modules/@rstest/core/bin/rstest.js run __tests__/Native/examples.test.ts __tests__/Tooling/examples`.

Keep every directory to seven entries and source files to 600 lines. Add API recipes incrementally; this is not a request to bulk-migrate all existing prose.


**Binary required.** Build the native linter before linting, or configure `CARBURETOR_LINT_BIN` to
point to an existing binary. The verification block below builds it first.

**Documentation examples:** every TypeScript/TSX block in README and docs is generated from `examples/` via `<!-- example:file ... -->` markers; run `npm run docs:check` after editing examples or docs.

```bash
cargo build --release --manifest-path native/Cargo.toml
npm ci
npm run build        # Rslib: bundleless library, bundled lint plugin, declarations via tsgo
npm run typecheck    # TypeScript 7, library and plugin
npm run lint         # oxlint: native rules, type-aware rules, and this project's own 26 (one opt-in)
npm run check:layout # the three structural rules above
npm test             # Rstest + @testing-library/react
npm run test:rules   # just the lint rules, when that is what you changed
npm run check:task   # tiered local check for the files you touched (see docs/testing-tiers.md)
```

For day-to-day work, `npm run check:task` selects only the checks affected by
your changed files. Full coverage still comes from CI — the tiers are described
in `docs/testing-tiers.md`.

`dist/` is generated and ignored by Git; do not commit bundles or declarations.
`npm pack` and `npm publish` rebuild it through `prepack`. The package's `files`
allowlist still includes `dist`, so published consumers receive compiled artifacts.

The demo app has its own package:

```bash
cd lib && npm ci && npm start
```

The repository commits both npm lockfiles. Use `npm ci` for a reproducible checkout;
do not refresh dependencies or versions as part of an unrelated change.

## Native binaries in CI

Rust steps run only when the Rust code changes. Every native cache key is hashed
from all binary build inputs — `native/src/**`, `native/Cargo.toml`,
`native/Cargo.lock`, `native/build.rs` and any `rust-toolchain*` file — so a
JS-only push restores the prebuilt host binary (`native-bin-linux-<hash>`) and
skips the Rust toolchain, the cargo caches and the compile entirely.

In the full tier (`ci.yml`) the `native` job records a `native-verified-<hash>`
marker after `cargo test` and `cargo clippy` both pass; later runs on the same
Rust inputs skip straight through, including the nightly. Dispatching the
workflow with `force_native: true` reruns them regardless. The six platform
packages cache their cross binaries under `native-pkg-<target>-<hash>`; the
smoke and packaging steps still run on a cache hit, so the uploaded
`carburetor-lint-*` artifacts are identical either way.

GitHub evicts caches after 7 days without use (and caps the total at 10 GB per
repository), so an evicted entry simply means the affected job rebuilds — a
miss is slower, never incorrect. `release.yml` is unaffected: it still requires
a green full-tier run for the exact SHA and downloads the `carburetor-lint-*`
artifacts from that run.

## Pull requests

- Keep the checks above green. A failing or flaky test is fixed in the same change,
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
