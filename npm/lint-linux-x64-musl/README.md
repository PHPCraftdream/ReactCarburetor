# @react-carburetor/lint-linux-x64-musl

The `linux-x64-musl` binary of React Carburetor's native linter. npm installs this package
on its own, as an optional dependency of
[`@react-carburetor/lint`](https://www.npmjs.com/package/@react-carburetor/lint), when the
machine's `os`, `cpu` and `libc` match; do not depend on it directly.

Usage and rules: [native/README.md](https://github.com/PHPCraftdream/ReactCarburetor/blob/master/native/README.md).

Licensed under MIT OR Apache-2.0; the notices of the Rust crates linked into the binary are in
`THIRD-PARTY-LICENSES.txt`.
