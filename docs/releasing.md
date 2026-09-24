# Release checklist

The repository is preparing its first public npm release. `react-carburetor`
and `carburetor-lint` were not on npm when this checklist was written. Do not
publish or change package versions without the maintainer's explicit release
decision.

1. Confirm the intended versions, update the changelog, and verify the npm
   package names are available to the publisher.
2. Require a green CI run for the release commit, including React 18, the demo,
   native tests, and all six platform-binary jobs. Run `npm ci`,
   `npm run build`, `npm run typecheck`, `npm run lint`,
   `npm run check:layout`, and `npm test` from a clean checkout.
3. Inspect `npm pack --dry-run --json` for the root library, the launcher under
   `npm/carburetor-lint`, and each platform package. Every tarball must include
   `LICENSE`, `LICENSE-MIT`, and `LICENSE-APACHE`. The platform tarballs must
   also include the binary built for their declared `os`/`cpu`/`libc` target.
4. Publish the six platform packages first, then `carburetor-lint` (whose
   optional dependencies name those exact versions), then `react-carburetor`.
   The CI workflow currently builds and packs platform artifacts; publication
   remains a separate maintainer action.
5. Install both public packages in a clean consumer project and exercise the
   ESM/CJS library imports, the lint bridge, and the standalone binary. Check
   the npm registry pages and package contents before announcing the release.
6. Replace the README's pre-release notice and badge with a verified npm
   release link or version badge only after publication succeeds.

The license copies under `npm/` are byte-identical to the root texts and are
checked by `__tests__/Plugin/packageLicenses.test.ts`. Keep them in sync when
editing a license. The root `LICENSE` grants users the choice of MIT or
Apache-2.0; the two full texts accompany every distributable package.
