# carburetor-lint

React Carburetor's native linter: 22 rules for React class-component state mistakes, run as one
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
next to `react-carburetor` and the plugin finds it. See the repository's `native/README.md` for
the full option reference, exit codes, configuration file and suppression comments.
