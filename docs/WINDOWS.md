# Windows x64 installers

Vokeyra can be packaged as an EXE installer (NSIS) or an MSI installer (WiX). Both contain the same application and use the same per-user settings, models and history. Model weights are downloaded separately.

| Format | Installation scope | Update target |
| --- | --- | --- |
| EXE | Current user | `windows-x86_64-nsis` |
| MSI | All users; administrator approval required | `windows-x86_64-msi` |

Use the same installer format for subsequent updates. Switching between EXE and MSI is not a verified migration path; installing both can leave duplicate installer entries. User data is stored separately from the installation directory.

## Build

Run on Windows x64 with Node.js and the Tauri build prerequisites installed:

```powershell
# Build both formats.
npm.cmd run dist:win

# Build only MSI.
npm.cmd run dist:win:msi
```

Output: `src-tauri/target/release/bundle/nsis` and `src-tauri/target/release/bundle/msi`. MSI uses the English installer interface; the app itself still supports Russian and English. The WiX upgrade code is fixed in `src-tauri/tauri.conf.json` and must remain unchanged in later releases.

The packaging script creates `.sig` files and `latest-win32-x64.json` using the local, ignored Tauri updater key. An MSI-only build produces only the MSI update target. A combined build also retains the legacy Windows target pointing to EXE. Merge the Windows manifest with the Linux manifest before publishing a multi-platform release.

For an unsigned CI verification build:

```powershell
npm.cmd run dist:win -- --unsigned
```

Tauri updater signatures are separate from Windows Authenticode signing. MSI does not bypass Windows publisher checks. Neither installer is currently Authenticode-signed; see [the signing policy](CODE_SIGNING.md).

Reference: [Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/).
