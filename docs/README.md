# Documentation

Start with the [project README](../README.md) for installation status, concepts,
examples, and the public API.

## Using the project

- [Examples](examples/README.md) — a runnable example for every public export, grouped by area,
  with a guide to choosing an API.
- [Adopting in an existing app](adopting.md) — moving an app over one store at a time.
- [FAQ](faq.md) — short answers to the common questions.
- [API reference](api-reference.md) — public engine, cache, tooling, and interop symbols.
- [Troubleshooting](troubleshooting.md) — symptoms, StrictMode effects, and cache size boundaries.
- [Hazard catalogue](hazards.md) — silent misuse patterns and lint-rule specifications.
- [Testing tiers](testing-tiers.md) — what each local/CI tier runs.
- [Async resource cache](promise-cache.md) — keys, freshness, invalidation, and hydration.
- [Lint rule reference](rules.md) — rules, severities, and host setup.
- [Native linter](../native/README.md) — binary usage and supported platforms.
- [React compatibility](react-compatibility.md) — supported versions, how the library binds to
  the consumer's React, the dual-package/duplicate-React hazard and its fixes, and how
  compatibility is tested.

## Contributing and maintaining

- [Contributing](../CONTRIBUTING.md) — development checks and design conventions.
- [Security policy](../SECURITY.md) and [Code of Conduct](../CODE_OF_CONDUCT.md).
- [Release checklist](releasing.md) — packaging and first npm publication.
- [Changelog](../CHANGELOG.md) — shipped and unreleased changes.

The dated review and checkpoint files in this directory record what was known
at a particular revision. They are historical audit notes, not a substitute
for the current README, rule reference, or tests.
