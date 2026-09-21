# carburetor-lint

The native implementation of React Carburetor's lint rules: one process over a directory tree,
parsing in parallel, instead of a JavaScript rule invoked per file through a linter's plugin bridge.

```bash
cargo build --release
./target/release/carburetor-lint ../lib/src --format=json
```

## Why native, in numbers

Measured on this repository — 157 source files, best of several runs:

| Pass | Time |
|------|------|
| oxlint's own native rules, whole tree | 315 ms |
| the same plus 22 rules as a JavaScript plugin | 585 ms |
| this binary, whole tree | **20 ms** |

So the JavaScript rule layer costs 270 ms, and the native pass that replaces it costs 20 ms —
including walking the tree, parsing every file and serialising the result. Parsing dominates that
number and is already paid, so adding the remaining rules adds visits over a tree that is already
built; the figure will grow, and it is re-measured as rules land rather than assumed.

The reason this matters is not developer patience. These rules run on every commit in every project
that uses the library, so the difference is multiplied by all of them — the same argument the engine
itself makes about re-renders and allocations.

## How it relates to the JavaScript plugin

The plugin in `../plugin/src` stays, but as a **bridge** rather than a second implementation: it runs
this binary once per lint run and reports what it found through the host's own `context.report`. That
buys three things for free — suppression comments, editor diagnostics and per-project configuration
are all applied by oxlint or ESLint, exactly as for any other rule.

"Once per lint run" is a hard requirement, and it is met by measurement rather than by hope: ESLint's
multithreaded mode runs one process with several worker threads (shared `process.pid`, distinct
`threadId`), so the bridge keys the run by pid, lets the first worker win an atomic lock, and has the
others wait for its result.

## Running it directly

The binary is also usable on its own, so a CI job can check the carburetor rules without starting
Node at all — which is the cheapest form of the same energy argument.

```bash
carburetor-lint [options] [paths...]
```

| Option | Meaning |
|--------|---------|
| `--config <path>` | configuration file; default `./.carburetorrc.json` when it exists |
| `--rule <name>=<severity>` | override one rule: `error`, `warn` or `off` |
| `--format <human\|json>` | output format; default human |
| `--deny-warnings` | fail the run on warnings too |
| `--fix` | write every available fix to disk |
| `--fix-dry-run` | print what `--fix` would change, without writing it |
| `-h`, `--help` | print the usage |

Every valued flag takes both spellings, `--flag value` and `--flag=value`.

**Configuration.** JSON, because serde_json is already a dependency and oxlint, the ESLint host and
this crate then share one format — one format, no second parser. Two keys, `rules` and `ignore`;
anything else is rejected rather than ignored, so a typo fails loudly. A rule's value is a severity
string or ESLint's `[severity, options]` pair. Rule names may be bare or carry the `carburetor/`
prefix. A missing default config is not an error — the defaults apply — but a `--config` path that
is not there is, because the caller asked for that exact file.

The defaults mirror `../plugin/src/recommended.mts`, which is the single source of truth for
strictness; a test in the JavaScript suite compares the two tables so the binary and the plugin
cannot become two different products. A rule set to `off` never runs, so turning rules off makes the
pass cheaper rather than only quieter.

**Suppression comments.** `carburetor-disable-next-line <rules>` for the line below, and
`carburetor-disable <rules>` for the whole file. The oxlint spellings `oxlint-disable-next-line` and
`oxlint-disable` are honoured identically, so one comment silences a rule in both linters. With no
rule list a directive silences every carburetor rule. A directive must be the whole comment: prose
that merely mentions one silences nothing.

**Exit codes.** `0` clean, `1` problems found, `2` the linter itself failed — an unreadable or
malformed config, an invalid command line. CI has to tell a broken tool from a failing check.
A warning alone does not fail the run, the line oxlint draws too; `--deny-warnings` opts in.

**The walk** honours `.gitignore` and the config's `ignore` patterns, and never enters
`node_modules`, `dist`, `target` or `worktrees` whatever the ignore files say.

**Fixes.** A rule may attach a fix — a byte range and its replacement text — to a diagnostic;
`--fix` applies every one it can and `--fix-dry-run` previews the same result as a diff without
touching disk. Not every violation has one: a fix only exists where the rewrite is unambiguous, and
a rule says nothing rather than guess. Two fixes that overlap in one file are resolved by keeping
whichever starts first and leaving the other for a later pass, since applying it shifts the text the
second fix's offsets were computed against; the file is re-parsed and re-checked after every change,
up to ten passes, so a fix that turns out not to resolve its own violation cannot hang the tool. A
fix that would leave the file unable to parse is discarded instead of published — the last text
known to parse is what gets written, or previewed. Writing goes through a temporary file and a
single rename, so a process killed mid-write leaves the original untouched. `no-lifecycle-class-property`
is the first rule with one: a plain `name = () => body` property becomes `name() body`, the method
form the base class actually dispatches to.

## The npm packages

The binary ships the way oxlint ships its own: `carburetor-lint` on npm is a launcher script
that finds the compiled binary and hands it your arguments, stdio and exit code, and the
megabytes live in a platform package beside it, `carburetor-lint-<platform>`. The launcher
package lists all six under `optionalDependencies`, and each platform package declares `os` and
`cpu` — `libc` too on linux, where glibc and musl builds are not interchangeable — so an
install downloads exactly the one binary that runs on the installing machine: `win32-x64`,
`darwin-arm64`, `darwin-x64`, `linux-x64-gnu`, `linux-x64-musl`, `linux-arm64-gnu`.

```bash
npm install --save-dev carburetor-lint
npx carburetor-lint --format=json src
npx carburetor-lint --fix src
```

The packages live in `../npm/`, one directory each, versioned in lockstep with this crate. The
CI `native-packages` job builds all six cargo targets, runs each produced binary against a
fixture to prove the artefact executes on its target — compiling for a target proves nothing
about the result — and uploads the packed tarballs as artifacts; publishing itself stays a hand
step, `npm publish` from each package directory.

The lint bridge in `../plugin/src` looks the binary up through the same platform packages, so a
project using `react-carburetor/lint` should install `carburetor-lint` alongside it. When
neither a platform package nor a `CARBURETOR_LINT_BIN` override nor a workspace build is
present, the bridge fails loudly, naming the missing platform package — a missing binary is a
broken install to report, never a silent, wrong "no problems".

## Layout

- `src/main.rs` — the command line, the walk, the parallel parse, the fix loop, the output formats,
  the exit codes.
- `src/config.rs` — severities per rule, per-rule options, ignore patterns.
- `src/suppression.rs` — the disable directives one file carries.
- `src/fix.rs` — applying a rule's suggested edit: overlap resolution, the atomic write, the dry-run
  diff.
- `src/rules/` — one module per rule, named after it, with the hazard it detects in the header.
- `tests/cli.rs` — the end-to-end tests, run against the built binary.

Rules are specified in `../docs/hazards.md`: for each one, the code that triggers it, why it is
silent at runtime, the supported form, and where the rule can be wrong. The specification is the
contract; this crate and the bridge are implementations of it.

Dependency versions are pinned exactly, including the parser: oxc's AST types change between minor
versions, and an unpinned parser would break the rules silently rather than loudly.
