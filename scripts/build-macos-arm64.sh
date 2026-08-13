#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'Error: this build must run on macOS because Tauri needs the Apple SDK.\n' >&2
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  printf 'Warning: this Mac is not Apple Silicon; cross-compiling for arm64.\n' >&2
fi

command -v npm >/dev/null || { printf 'Error: npm is required.\n' >&2; exit 1; }
command -v rustup >/dev/null || { printf 'Error: Rust/rustup is required.\n' >&2; exit 1; }
command -v xcodebuild >/dev/null || { printf 'Error: install Xcode Command Line Tools with xcode-select --install.\n' >&2; exit 1; }

rustup target add aarch64-apple-darwin
npm ci
npm test
npm run lint
npm run tauri build -- --target aarch64-apple-darwin --bundles app,dmg

printf '\nBuild complete. Bundles:\n'
printf '  src-tauri/target/aarch64-apple-darwin/release/bundle/macos/\n'
printf '  src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/\n'
