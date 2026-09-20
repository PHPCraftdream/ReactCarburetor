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

## Layout

- `src/main.rs` — the walk, the parallel parse, the output formats and the exit codes.
- `src/rules/` — one module per rule, named after it, with the hazard it detects in the header.

Rules are specified in `../docs/hazards.md`: for each one, the code that triggers it, why it is
silent at runtime, the supported form, and where the rule can be wrong. The specification is the
contract; this crate and the bridge are implementations of it.

Dependency versions are pinned exactly, including the parser: oxc's AST types change between minor
versions, and an unpinned parser would break the rules silently rather than loudly.
