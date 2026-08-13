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

## Build for macOS

Run this command on the target Mac:

```bash
npm run tauri build
```

Tauri will produce the `.app` bundle and `.dmg` in `src-tauri/target/release/bundle/`.

## AWS design

Future S3 features will use the standard AWS SDK credential provider chain, including named profiles from `~/.aws/config` and `~/.aws/credentials`. Access keys will never be stored in this repository or the app database.

## Quality checks

```bash
npm test
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```
