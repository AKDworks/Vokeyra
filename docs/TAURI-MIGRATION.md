# Tauri desktop

Vokeyra 0.3.0 uses Tauri 2 and the system WebView (WebView2 on Windows).
The existing HTML/CSS interface is shared by both windows. A bundled private
Node.js runtime runs the model catalog, verified downloads, history and ONNX
engines. Node and Rust do not need to be installed by users.

## Development

Install Node.js 24, Rust stable and the Windows C++ build tools, then run:

```sh
npm ci
npm run dev
```

`npm run build` prepares the frontend and service; `npm run dist:win` creates
the Tauri NSIS installer. Never package `dist/desktop` with electron-builder.
The runtime copied during the build must be the target platform/architecture.
Linux system integration is a separate task; a Linux build is not yet a promise
of Windows feature parity.

Restart `npm run dev` after editing the Node service. Vite reloads frontend
changes; Tauri watches Rust changes.

## Architecture and data

`src-tauri` owns windows, shortcuts, clipboard, tray, startup, external links and
signed updates. `src/main/service.ts` is a private service over inherited stdio
pipes, without a listening network port. Only allowlisted commands are exposed
to the main window. The overlay may only read its own state or cancel recording.

The data directory remains `%APPDATA%/Vokeyra` on Windows, preserving the
Electron version's settings, recordings, history and downloaded models.
`VOKEYRA_TEST_DATA` selects an isolated profile for native smoke tests.

## Release signing

Tauri updater signatures are separate from Windows Authenticode signing.
Generate an updater key once with `tauri signer generate`, keep the private key
outside Git (the local default is `.signing/tauri-update.key`), and put the public
key in `src-tauri/tauri.conf.json`. Back up the private key securely; future
updates must be signed by the same key.

`npm run dist:win` requires `TAURI_SIGNING_PRIVATE_KEY` or the ignored local key.
The installer, its `.sig`, and `latest.json` must be uploaded to a release.
`latest.json` follows the Tauri updater schema and references the matching signed
installer at an HTTPS GitHub release URL. No unsigned installer is automatically
executed by the updater. Releases and commits still require the owner's command.

Before release, verify migration from an installed Electron version, microphone
permission, all engine families, paste/clipboard restoration, push-to-talk,
system sound restoration, tray shutdown and a signed update between two builds.
