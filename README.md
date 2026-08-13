# Momentum

A polished, local-first desktop task manager for macOS, built with Tauri, React, and TypeScript.

## Current milestone

- Inbox, Today, Upcoming, and Completed views
- Fast task capture
- Projects, priorities, due dates, notes, completion, reopening, and deletion
- Search and responsive task-detail panel
- Local persistence with browser/WebView storage
- Dark, keyboard-friendly desktop interface
- Tauri desktop shell configured for macOS packaging

This first milestone intentionally does **not** claim multi-device synchronization yet. SQLite persistence, AWS profile discovery, encrypted S3 backups, and operation-based sync are planned next.

## Prerequisites

- Node.js 20+
- Rust stable
- macOS: Xcode Command Line Tools

```bash
xcode-select --install
```

## Development

```bash
npm install
npm test
npm run tauri dev
```

For frontend-only development:

```bash
npm run dev
```

## Build for Apple Silicon macOS

### On an Apple Silicon Mac

```bash
./scripts/build-macos-arm64.sh
```

The script verifies macOS prerequisites, runs tests and lint, and builds native ARM64 `.app` and `.dmg` bundles in:

```text
src-tauri/target/aarch64-apple-darwin/release/bundle/
```

### With GitHub Actions

The repository includes `.github/workflows/build-macos-arm64.yml`. Push the repository to GitHub, open **Actions → Build macOS Apple Silicon → Run workflow**, then download the `Momentum-macOS-Apple-Silicon-unsigned` artifact.

The current build is unsigned. macOS may require a right-click → **Open** for local testing. Public distribution requires an Apple Developer ID certificate and notarization credentials.

## AWS design

Future S3 features will use the standard AWS SDK credential provider chain, including named profiles from `~/.aws/config` and `~/.aws/credentials`. Access keys will never be stored in this repository or the app database.

## Quality checks

```bash
npm test
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```
