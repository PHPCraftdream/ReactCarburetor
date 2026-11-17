# @react-carburetor/lint

React Carburetor's native linter: 54 rules for state mistakes, avoidable allocations, component
shape and, opt-in, a functional CSS class methodology for Tailwind v4 stylesheets, run as one process
over a directory tree instead of once per file through a linter's plugin bridge.

```bash
npm install --save-dev @react-carburetor/lint

npx carburetor-lint src                          # report
npx carburetor-lint --fix src                    # apply the fixes rules can make
npx carburetor-lint --fix-dry-run src            # preview them
npx carburetor-lint --format=json src            # machine-readable output
npx carburetor-lint --stdin src/App.tsx < buf    # an unsaved buffer, checked as that file
npx carburetor-lint --init-classes src/styles/classes.css   # scaffold the functional-class floors
```

The installing machine downloads exactly one compiled binary: this package lists one
`@react-carburetor/lint-<platform>` package per supported platform under `optionalDependencies`, and
npm keeps only the one whose `os`/`cpu`/`libc` fields match. Supported platforms:
`w32-x64`, `w32-arm64`, `darwin-arm64`, `darwin-x64`, `linux-x64-gnu`, `linux-x64-musl`,
`linux-arm64-gnu`, `linux-arm64-musl`. The glibc builds run on glibc 2.28 and newer (RHEL 8, Debian 10,
Ubuntu 18.10 and later); the musl builds are static; the macOS builds target macOS 11 and later.

### Only your platform's binary is installed

Each `@react-carburetor/lint-<platform>` package declares the one `os`, `cpu` and (on Linux) `libc` it runs
on, so npm, pnpm and Yarn install the matching package and skip the other seven; none of them runs an
install script. CI proves it on every supported system, Alpine included: all eight packages are
offered to a fresh project and only the machine's own one may appear. Node 24 or newer is required
(`engines.node`; npm 11 ships with it).

What to know when the install and the run happen on different machines:

- **Docker, CI caches, copied `node_modules`.** Install where the code runs. A `node_modules` copied from
  macOS into a Linux container holds the macOS binary; the launcher says so (`no binary for
  linux-x64 (expected package @react-carburetor/lint-linux-x64-gnu)`) and exits `2`. Reinstall instead.
- **Lockfiles made on another OS.** The lockfile keeps every platform package, so one lockfile serves
  all machines. If a package manager installed an old lockfile without them, regenerate it with a
  current npm/pnpm/Yarn.
- **Installing for another platform on purpose** (building an image for a different architecture):
  npm `--os=linux --cpu=arm64 --libc=glibc`, pnpm `supportedArchitectures` in `.npmrc`/`package.json`,
  Yarn `supportedArchitectures` in `.yarnrc.yml`.
- **`--omit=optional` / `--no-optional`** skips the binary altogether. The launcher then exits `2`
  naming the missing package; reinstall without the flag or set `CARBURETOR_LINT_BIN` to a binary.
- **A platform without a package** (FreeBSD, 32-bit, RISC-V, Android): build `native/` from the
  repository with Cargo and point `CARBURETOR_LINT_BIN` at the result. The plugin's bridge checks
  the binary's `--version` protocol before the first run, so keep the binary current with the
  plugin — an old one fails lint with a rebuild instruction.

The same binary powers the `@react-carburetor/core/lint` oxlint/ESLint plugin — install this package
next to `@react-carburetor/core` and the plugin finds it.

| Kind | Recognised names |
|------|------------------|
| Store | `Carburetor`, `ResourceCarburetor`, plus `storeBases` |
| Component | `AntiHookComponent`, `ScopedAntiHookComponent`, plus `componentBases` |
| Render | `render` |

Recognition is syntactic. A project base class that extends a recognised one is listed under
`componentBases` or `storeBases` in `.carburetorrc.json`; `no-unrecognized-base` points out one
that is missing. Suppress an individual report with `// carburetor-disable-next-line <rule>` or a
whole file with `// carburetor-disable <rule>`; either directive without a rule list silences all
carburetor rules (in a stylesheet, the same directives as `/* … */` comments).

**Configuration.** `.carburetorrc.json` holds `rules` (a severity, or `[severity, options]`),
`ignore`, `overrides`, `componentBases`, `storeBases`, `classes` and `root`; an unknown key fails
loudly. Six rules take options: `require-module-function` (`scope`), `max-render-depth` and
`max-render-lines` (`max`), `max-line-length`, `no-parent-import` (`roots`) and `require-tsdoc`.
The `classes` section names the stylesheets and switches on the functional-class rules, which check
both the CSS and every `className`; see the repository's
[functional classes guide](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/functional-classes.md).
The repository's [`native/README.md`](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/native/README.md)
is the full command and configuration reference, and
[`docs/rules.md`](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/docs/rules.md) lists every rule.

**Exit codes.** `0` clean, `1` lint problems, `2` missing paths or launcher/linter failure. The
launcher exits `2` if the native binary cannot start or terminates by signal; otherwise it
forwards the native exit code.

## License

Choose either MIT or Apache-2.0. The package includes [LICENSE](LICENSE),
[LICENSE-MIT](LICENSE-MIT), and [LICENSE-APACHE](LICENSE-APACHE).
