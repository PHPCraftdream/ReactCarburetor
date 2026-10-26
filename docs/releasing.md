# Release checklist

The repository is preparing its first public npm release. `react-carburetor`
and `carburetor-lint` were not on npm when this checklist was written. Do not
publish or change package versions without the maintainer's explicit release
decision. The first release is `0.1.0`.

Ten packages ship under one version: the library `react-carburetor`, the launcher
`carburetor-lint`, and eight `carburetor-lint-<platform>` packages that each carry one
compiled binary (`win32-x64`, `win32-arm64`, `darwin-arm64`, `darwin-x64`, `linux-x64-gnu`,
`linux-arm64-gnu`, `linux-x64-musl`, `linux-arm64-musl`). A platform is added in one place,
the launcher's `optionalDependencies`; the release workflow, the tests and the checks read
the list from there.

1. Confirm the intended version and verify the npm package names are available to the publisher.
   A dry run accepts the existing `[Unreleased]` changelog section, so packaging can be verified
   before the release date is chosen. Before publishing, rename it to
   `## [0.1.0] - YYYY-MM-DD` with the actual release date; a real publish requires that section.
2. Require a green full-tier CI run for the release commit: the React 18 Engine/Demo
   compatibility suites, the native tests, the Node floor jobs, the consumer matrix and all
   eight platform-binary legs. The Release workflow starts that run itself when the commit
   has none. Before that, from a clean checkout: `npm ci`, `npm run build`, build the native
   linter with `cargo build --release --locked` from `native/`, then `npm run typecheck`,
   `npm run lint`, `npm run check:layout` and `npm test`.
3. Inspect `npm pack --dry-run --json` for the root library, the launcher under
   `npm/carburetor-lint`, and each platform package. Every tarball must include
   `LICENSE`, `LICENSE-MIT`, and `LICENSE-APACHE`. The platform tarballs must
   also include the binary built for their declared `os`/`cpu`/`libc` target and
   `THIRD-PARTY-LICENSES.txt`, the attribution for the Rust crates linked into it.
4. Publish the eight platform packages first, then `carburetor-lint` (whose
   optional dependencies name those exact versions), then `react-carburetor`.
   The `native-packages.yml` workflow builds and packs the platform artifacts; the Release
   workflow (below) publishes them, and only when a maintainer starts it.
5. The Release workflow ends by installing the published packages from the registry on
   every supported platform (`post-publish.yml`). Also check the npm registry pages and
   package contents before announcing the release.
6. Replace the README's pre-release notice and badge with a verified npm
   release link or version badge only after publication succeeds.

The license copies under `npm/` are byte-identical to the root texts and are
checked by `__tests__/Plugin/packageLicenses.test.ts`. Keep them in sync when
editing a license. The root `LICENSE` grants users the choice of MIT or
Apache-2.0; the two full texts accompany every distributable package.

## What is checked before a binary ships

Each leg of `.github/workflows/native-packages.yml` builds one cargo target on its own
operating system with the pinned toolchain (`RUST_VERSION` in that file) and `--locked`, then:

- **Portability** (`scripts/tools/release/portability`). The binary is read, not just run: the
  glibc builds must need no symbol newer than glibc 2.28 and only the libraries every glibc
  system has (they are built inside `manylinux_2_28`); the musl builds must be fully static;
  the Windows builds must import no Visual C++ runtime (the C runtime is linked in,
  `native/.cargo/config.toml`); the macOS builds must link only system libraries and target
  macOS 11 or later (`MACOSX_DEPLOYMENT_TARGET`).
- **It runs.** `--help`, and a fixture lint that must exit 1 with its rule id.
- **It packs with its attribution.** `native/THIRD-PARTY-LICENSES.txt` is copied into the
  package; the tarball must contain it.
- **It installs.** The tarball is unpacked next to the packed launcher and run through
  it, which proves the binary's execute bit, the launcher's lookup and the binary together.

The attribution is generated, not written: `node scripts/tools/release/attribution/thirdParty.mjs
--write` lists the crates linked into all eight targets from `cargo metadata` and prints each
distinct license text once. `licenses.yml` re-generates it with `--check` whenever the
dependencies change, so a new crate cannot ship without its notice. A crate whose published
source carries no license file needs an entry in `scripts/tools/release/attribution/supplements.json`
that points at the upstream text.

The library itself is installed from its packed tarball on Node 24.0.0 (the floor in
`engines.node`), on the newest 24 and on the newest Node release, as CommonJS and as ESM,
development and production builds (`node-floor` in `ci.yml`).

Each machine must end up with the one binary of its own platform, and the `gating` job of
`native-packages.yml` proves it: on every supported operating system (and in Alpine containers, to
show that npm tells musl from glibc) all eight platform packages are offered to a fresh project next to
the launcher, only the matching one may be installed, and the launcher must run it
(`scripts/tools/release/ci/verifyGating.mjs`). `post-publish.yml` repeats the check against the
registry after a release.

## Release workflow

`.github/workflows/release.yml` publishes all ten packages under one version. It runs only
when started by hand (Actions → Release → Run workflow) and only from `master`. It needs a
successful full-tier `.github/workflows/ci.yml` run on that exact SHA and starts one itself,
waiting for it, when there is none; a `ci-fast.yml` success does not qualify. The platform
packages are artifacts produced by that full CI run, so what is published is what was built and
executed on its own targets. Both dry runs and real publishes reject mismatched package versions
and a failing `.github/workflows/audit.yml` check of the shipped npm dependencies or the Rust
crates linked into the binaries. A real publish also requires a dated changelog section for the
version; a dry run can use `[Unreleased]` instead. This exception never permits publication.

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
   packages, scope: all packages (the ten packages do not exist yet, so a token limited to named
   packages cannot create them). It must be able to publish without an interactive one-time
   password. Set an expiry.
2. Settings → Secrets and variables → Actions → New secret `NPM_TOKEN` (repository secret, or a
   secret of the `npm` environment).

#### Setup for `trusted`

For each of the ten packages: npmjs.com → the package → Settings → Trusted Publisher → GitHub
Actions, then

- organization or user: `PHPCraftdream`
- repository: `ReactCarburetor`
- workflow filename: `release.yml`
- environment name: `npm`

The setting lives on a package's own page, so the package has to exist first: publish the first
version of all ten with `auth = token`, configure the trusted publisher on each, and use
`trusted` from the next release on. After that the `NPM_TOKEN` secret can be deleted and the
packages can be switched to "require two-factor authentication and disallow tokens".

The job needs npm 11.5.1 or newer (Node 24 ships it); it checks and fails early otherwise. It
runs with `id-token: write`, which is what lets npm exchange the identity and sign provenance.

### Cutting a release

1. Confirm the same intended version in `package.json`, `npm/carburetor-lint/package.json`, the eight
   `npm/carburetor-lint-*/package.json` and the `optionalDependencies` of `carburetor-lint`.
   Do not change versions just to run a dry run. The workflow always rejects version mismatches;
   `[Unreleased]` is sufficient only while `dry_run` is on.
2. Push to `master`. A full-tier run for that exact SHA is optional: the Release workflow starts
   one when there is none (`gh workflow run ci.yml --ref master` does the same by hand). A
   fast-tier `ci-fast.yml` run does not count.
3. Actions → Release → Run workflow, branch `master`, with `dry_run` left on (the default). It
   downloads platform artifacts from the qualifying run, packs and verifies all packages, and runs
   `npm publish --dry-run` without publishing.
4. Before a real publish, rename `[Unreleased]` to `## [<version>] - YYYY-MM-DD` with the release
   date, commit and push that change, and repeat the dry run on the exact final commit. Only after
   it passes and the maintainer explicitly authorizes publication, run with `dry_run` off
   (approve the `npm` environment if reviewers are set). It publishes the eight platform packages,
   then `carburetor-lint`, then `react-carburetor`, and then installs them from the registry on
   every platform.
5. A version already on the registry is skipped, so a run that stopped halfway is simply started
   again. `post-publish.yml` can also be started alone against any published version.

`dist_tag` is `latest` by default; use `next` (or another tag) for a prerelease so it does not
become what `npm install` picks.
