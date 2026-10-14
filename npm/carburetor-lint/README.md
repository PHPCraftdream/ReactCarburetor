# carburetor-lint

React Carburetor's native linter: 25 rules for state mistakes and avoidable allocations, run as one
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
`win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64-gnu`, `linux-x64-musl`,
`linux-arm64-gnu`.

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
