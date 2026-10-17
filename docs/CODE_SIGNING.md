# Code signing policy

## Current status

Windows Authenticode signing is not yet configured. A SignPath Foundation application is being prepared; no approval or signing service has been granted. Do not describe a release as signed by SignPath before the integration is approved and its artifacts have been signed.

Tauri updater signatures (`.sig`) verify application updates. They are separate from Windows Authenticode signatures and do not identify a trusted Windows publisher.

## Project roles

- Source maintainer and committer: [AKDworks](https://github.com/AKDworks).
- Reviewer of external contributions: [AKDworks](https://github.com/AKDworks).
- Intended signing approver: [AKDworks](https://github.com/AKDworks), subject to the signing provider's onboarding.

Signing is intended for Vokeyra's own application executable, its Windows desktop helper, and its installer. Third-party runtimes, speech engines, and native libraries retain their original provenance and licenses; they must not be individually re-signed as Vokeyra's own binaries.

## Build and approval

The source includes a [Windows verification workflow](../.github/workflows/windows-build.yml) and a [Linux verification workflow](../.github/workflows/linux-build.yml). They build test artifacts without release publication or signing credentials. Both passed for commit `8560e2c`: [Windows](https://github.com/AKDworks/Vokeyra/actions/runs/39040820303), [Linux](https://github.com/AKDworks/Vokeyra/actions/runs/39040820359). The Linux run also checks the packaged application and virtual microphone. These verification runs do not constitute approval by a signing provider.

Each public release and each future Authenticode signing request requires approval from the project owner. Multi-factor authentication for the source repository and signing account, final provider configuration, and review of artifact metadata are onboarding requirements to complete before signing is enabled.

Once a signing provider is approved, its required attribution and the verified signing process will be added here. This policy does not imply that approval has already occurred.

See the [Privacy policy](../PRIVACY.md) and [Third-Party Notices](../THIRD-PARTY-NOTICES.md).
