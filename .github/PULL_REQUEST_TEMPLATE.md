## What and why

<!-- One or two sentences: the behaviour this changes and the reason. Link the issue if there is one. -->

## Checks

- [ ] `npm run check:task` passes for the changed areas (see `docs/testing-tiers.md`)
- [ ] Behaviour changes have a test that fails without the change
- [ ] Public API or documented behaviour changes are reflected in `README.md`, `docs/` and `CHANGELOG.md`
- [ ] New documentation examples that compile on their own carry `<!-- example:compile -->`
- [ ] Native rule changes run `cargo test` and `cargo clippy --all-targets -- -D warnings` in `native/`
