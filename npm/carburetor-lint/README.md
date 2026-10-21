# carburetor-lint

React Carburetor's native linter: 27 rules for state mistakes and avoidable allocations, run as one
process over a directory tree instead of once per file through a linter's plugin bridge.

```bash
npm install --save-dev carburetor-lint

npx carburetor-lint src                 # report
npx carburetor-lint --fix src           # apply the fixes rules can make
npx carburetor-lint --fix-dry-run src   # preview them
npx carburetor-lint --format=json src   # machine-readable output
```

The installing machine downloads exactly one compiled binary: this package lists one
`carburetor-lint-<platform>` package per supported platform under `optionalDependencies`, and
npm keeps only the one whose `os`/`cpu`/`libc` fields match. Supported platforms:
`win32-x64`, `win32-arm64`, `darwin-arm64`, `darwin-x64`, `linux-x64-gnu`, `linux-x64-musl`,
`linux-arm64-gnu`, `linux-arm64-musl`. The glibc builds run on glibc 2.28 and newer (RHEL 8, Debian 10,
Ubuntu 18.10 and later); the musl builds are static; the macOS builds target macOS 11 and later.

### Only your platform's binary is installed

Each `carburetor-lint-<platform>` package declares the one `os`, `cpu` and (on Linux) `libc` it runs
on, so npm, pnpm and Yarn install the matching package and skip the other seven; none of them runs an
install script. CI proves it on every supported system, Alpine included: all eight packages are
offered to a fresh project and only the machine's own one may appear. Node 24 or newer is required
(`engines.node`; npm 11 ships with it).

What to know when the install and the run happen on different machines:

- **Docker, CI caches, copied `node_modules`.** Install where the code runs. A `node_modules` copied from
  macOS into a Linux container holds the macOS binary; the launcher says so (`no binary for
  linux-x64 (expected package carburetor-lint-linux-x64-gnu)`) and exits `2`. Reinstall instead.
- **Lockfiles made on another OS.** The lockfile keeps every platform package, so one lockfile serves
  all machines. If a package manager installed an old lockfile without them, regenerate it with a
  current npm/pnpm/Yarn.
- **Installing for another platform on purpose** (building an image for a different architecture):
  npm `--os=linux --cpu=arm64 --libc=glibc`, pnpm `supportedArchitectures` in `.npmrc`/`package.json`,
  Yarn `supportedArchitectures` in `.yarnrc.yml`.
- **`--omit=optional` / `--no-optional`** skips the binary altogether. The launcher then exits `2`
  naming the missing package; reinstall without the flag or set `CARBURETOR_LINT_BIN` to a binary.
- **A platform without a package** (FreeBSD, 32-bit, RISC-V, Android): build `native/` from the
  repository with Cargo and point `CARBURETOR_LINT_BIN` at the result.

The same binary powers the `react-carburetor/lint` oxlint/ESLint plugin — install this package
next to `react-carburetor` and the plugin finds it.

| Kind | Recognised names |
|------|------------------|
| Store | `Carburetor`, `ResourceCarburetor` |
| Component | `AntiHookComponent`, `ScopedAntiHookComponent` |
| Render | `render` |

Recognition is fixed and syntactic. Custom components should directly extend a recognised
component base; recognition is not generally transitive. These names cannot be configured.
Suppress an individual report with `// carburetor-disable-next-line <rule>` or a whole file with
`// carburetor-disable <rule>`; either directive without a rule list silences all carburetor rules.
Configuration accepts severity only: `error`, `warn` or `off`. Legacy `[severity, options]`
payloads may remain stored in host configuration, but native rules do not consume options. See
the repository's `native/README.md` for the full command and configuration reference.

**Exit codes.** `0` clean, `1` lint problems, `2` missing paths or launcher/linter failure. The
launcher exits `2` if the native binary cannot start or terminates by signal; otherwise it
forwards the native exit code.

## License

Choose either MIT or Apache-2.0. The package includes [LICENSE](LICENSE),
[LICENSE-MIT](LICENSE-MIT), and [LICENSE-APACHE](LICENSE-APACHE).
