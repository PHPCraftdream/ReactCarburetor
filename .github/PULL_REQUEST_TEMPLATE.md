## What and why

<!-- One or two sentences: the behaviour this changes and the reason. Link the issue if there is one. -->

## Checks

- [ ] `npm run check:task` passes for the changed areas (see `docs/testing-tiers.md`)
- [ ] Behaviour changes have a test that fails without the change
- [ ] Public API or documented behaviour changes are reflected in `README.md`, `docs/` and `CHANGELOG.md`
- [ ] New documentation examples are generated from `examples/` via `<!-- example:file ... -->` markers (`npm run docs:check` passes)
- [ ] Native rule changes run `cargo test` and `cargo clippy --all-targets -- -D warnings` in `native/`
