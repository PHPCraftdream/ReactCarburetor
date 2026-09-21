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

## Layout

- `src/main.rs` — the command line, the walk, the parallel parse, the output formats, the exit codes.
- `src/config.rs` — severities per rule, per-rule options, ignore patterns.
- `src/suppression.rs` — the disable directives one file carries.
- `src/rules/` — one module per rule, named after it, with the hazard it detects in the header.
- `tests/cli.rs` — the end-to-end tests, run against the built binary.

Rules are specified in `../docs/hazards.md`: for each one, the code that triggers it, why it is
silent at runtime, the supported form, and where the rule can be wrong. The specification is the
contract; this crate and the bridge are implementations of it.

Dependency versions are pinned exactly, including the parser: oxc's AST types change between minor
versions, and an unpinned parser would break the rules silently rather than loudly.
