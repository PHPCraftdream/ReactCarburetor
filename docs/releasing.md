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
   The CI workflow builds and packs the platform artifacts; the Release
   workflow (below) publishes them, and only when a maintainer starts it.
5. Install both public packages in a clean consumer project and exercise the
   ESM/CJS library imports, the lint bridge, and the standalone binary. Check
   the npm registry pages and package contents before announcing the release.
6. Replace the README's pre-release notice and badge with a verified npm
   release link or version badge only after publication succeeds.

The license copies under `npm/` are byte-identical to the root texts and are
checked by `__tests__/Plugin/packageLicenses.test.ts`. Keep them in sync when
editing a license. The root `LICENSE` grants users the choice of MIT or
Apache-2.0; the two full texts accompany every distributable package.

## Release workflow

`.github/workflows/release.yml` publishes all eight packages (`react-carburetor`, `carburetor-lint` and
the six `carburetor-lint-<platform>` packages) under one version. It runs only when started by hand
(Actions → Release → Run workflow), only from `master`, and only for a commit whose `CI` run
succeeded: the platform packages are the artifacts that run built and executed on their own targets,
so what is published is what was tested.

### Two ways to authenticate

| `auth` input | Credential | Provenance |
| --- | --- | --- |
| `token` | the `NPM_TOKEN` secret, written to a temporary npm config for the job | yes |
| `trusted` | none stored: npm exchanges the job's GitHub OIDC identity for a short-lived token | yes |

`trusted` is the default and the one to keep using; `token` exists for the first publication of a
package and as a fallback. Both modes run the same steps and differ only in credentials.

#### Setup common to both

1. Settings → Environments → New environment, named `npm`. Required reviewers are optional but
   recommended: the publish job waits for approval. The name is part of the trusted-publisher
   configuration below; change both or neither.

#### Setup for `token`

1. npmjs.com → Access Tokens → Generate New Token → Granular. Permission: read and write for
   packages, scope: all packages (the eight packages do not exist yet, so a token limited to named
   packages cannot create them). It must be able to publish without an interactive one-time
   password. Set an expiry.
2. Settings → Secrets and variables → Actions → New secret `NPM_TOKEN` (repository secret, or a
   secret of the `npm` environment).

#### Setup for `trusted`

For each of the eight packages: npmjs.com → the package → Settings → Trusted Publisher → GitHub
Actions, then

- organization or user: `PHPCraftdream`
- repository: `ReactCarburetor`
- workflow filename: `release.yml`
- environment name: `npm`

The setting lives on a package's own page, so the package has to exist first: publish the first
version of all eight with `auth = token`, configure the trusted publisher on each, and use
`trusted` from the next release on. After that the `NPM_TOKEN` secret can be deleted and the
packages can be switched to "require two-factor authentication and disallow tokens".

The job needs npm 11.5.1 or newer (Node 24 ships it); it checks and fails early otherwise. It
runs with `id-token: write`, which is what lets npm exchange the identity and sign provenance.

### Cutting a release

1. Set the same version in `package.json`, `npm/carburetor-lint/package.json`, the six
   `npm/carburetor-lint-*/package.json` and the `optionalDependencies` of `carburetor-lint`.
   Rename `[Unreleased]` in `CHANGELOG.md`. The workflow refuses to run if any of the eight
   versions disagree.
2. Push to `master` and wait for `CI` to pass on that commit.
3. Actions → Release → Run workflow, branch `master`, `dry_run` left on. It checks the commit and
   the versions, downloads the platform packages, packs the library and the launcher, lists every
   tarball, and runs `npm publish --dry-run` for all eight.
4. Run it again with `dry_run` off (approve the `npm` environment if reviewers are set). Packages
   are published in this order: the six platform packages, `carburetor-lint`, `react-carburetor`.
5. A version already on the registry is skipped, so a run that stopped halfway is simply started
   again.

`dist_tag` is `latest` by default; use `next` (or another tag) for a prerelease so it does not
become what `npm install` picks.
