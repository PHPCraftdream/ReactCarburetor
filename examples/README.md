# Documentation examples and native lint rules

Runnable examples live in `examples/`, separately from prose and generated output. Add TypeScript or TSX source there, import public APIs through `react-carburetor`, `react-carburetor/interop`, or `react-carburetor/lint`, and keep each directory to seven entries. `examples/tsconfig.json` checks the proper examples as a consumer against repository sources; it does not emit files.

Markdown can show a complete file with `<!-- example:compile -->` immediately before a fenced `ts`/`tsx` block. To include a portion of a runnable source file, use the documented region markers in that source; `npm run docs:build` copies those regions into the catalog and `npm run docs:check` verifies the generated output is current. Keep examples self-contained and meaningful rather than listing names solely for coverage.

`examples/wrong/` is deliberately excluded from the positive typecheck and lint pass. Its snippets demonstrate individual bad practices and are checked by `__tests__/Native/examples.test.ts`; each must produce exactly its named rule diagnostic and no unrelated findings. Do not suppress a rule in a proper example or disable allocation rules for the examples tree. Internal source-style checks for TSDoc and parent imports are not consumer-facing and have a limited examples-only override.

Run `npm run docs:build` after changing source regions, then `npm run check:examples` to check the generated documentation and linted positive examples. The examples test is run with `node node_modules/@rstest/core/bin/rstest.js run __tests__/Native/examples.test.ts __tests__/Tooling/examples`; `npm run typecheck` also checks proper example source files.

The examples are an ongoing API guide, not a bulk migration of the existing documentation. Add or update a focused example when a public API needs practical coverage; the export-coverage suite verifies current public names occur in real marked examples.
