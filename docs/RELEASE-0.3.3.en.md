## Linux and Wayland

- Added automatic text insertion on Wayland through wtype, ydotool, or dotool.
- Added recording controls for desktop shortcuts: toggle recording, press/release for push-to-talk, and cancel.
- Added system audio muting during recording on Linux.
- Improved the recording indicator and startup compatibility with NVIDIA graphics.

## Fixes

- Added a fallback to the default microphone when the selected device is unavailable.
- Fixed shortcut registration status and loading and saving Linux settings.
- Fixed audio restoration after switching output devices and clipboard restoration when text insertion fails.

Linux support remains experimental. Wayland shortcuts and automatic insertion require additional system tools and configuration. See the [Linux setup guide](https://github.com/AKDworks/Vokeyra/blob/v0.3.3/docs/LINUX.md).

Thanks to [@skippingclass](https://github.com/skippingclass) for the Linux and Wayland improvements.
