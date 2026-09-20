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

## Getting started

```bash
npm install
npm run build       # Rslib: bundleless CJS + declarations via tsgo
npm run typecheck   # TypeScript 7
npm run lint        # oxlint, including type-aware rules
npm test            # Rstest + @testing-library/react
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
