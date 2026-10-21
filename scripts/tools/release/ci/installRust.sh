#!/usr/bin/env bash
# Installs the pinned Rust toolchain and one compilation target, and rustup itself on images
# that ship none (a container, a Windows-on-ARM runner). Usage: installRust.sh <version> <target>
set -euo pipefail

version="${1:?usage: installRust.sh <version> <target>}"
target="${2:?usage: installRust.sh <version> <target>}"

addToPath() {
  local dir="$1"
  export PATH="$dir:$PATH"
  if [ -n "${GITHUB_PATH:-}" ]; then
    if command -v cygpath >/dev/null 2>&1; then dir="$(cygpath -w "$dir")"; fi
    echo "$dir" >> "$GITHUB_PATH"
  fi
}

if ! command -v rustup >/dev/null 2>&1; then
  case "${RUNNER_OS:-$(uname -s)}" in
    Windows | MINGW* | MSYS*)
      arch=x86_64
      if [ "${PROCESSOR_ARCHITECTURE:-}" = "ARM64" ]; then arch=aarch64; fi
      curl --proto '=https' --tlsv1.2 -sSfL -o rustup-init.exe "https://win.rustup.rs/$arch"
      ./rustup-init.exe -y --default-toolchain none --profile minimal
      rm -f rustup-init.exe
      ;;
    *)
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain none --profile minimal
      ;;
  esac
  addToPath "$HOME/.cargo/bin"
fi

rustup toolchain install "$version" --profile minimal --target "$target" --no-self-update
rustup default "$version"
rustc -Vv
cargo -V
