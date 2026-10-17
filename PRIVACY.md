# Privacy policy

Vokeyra processes audio and transcribes speech locally on your computer. It does not upload recordings, transcriptions, vocabulary, or replacement rules to an application server. It has no telemetry, analytics, advertising, user accounts, or cloud transcription service.

## Local data

Settings, downloaded models, recordings, and history are stored in the application's data folder. You can open that folder from About. History entries and downloaded models can be deleted in the application. Resetting settings does not delete recordings or models.

## Network requests

- Selecting a model downloads its files from the sources listed in the built-in model catalog, typically Hugging Face. These requests do not include recordings or transcription text.
- Checking for updates contacts GitHub. Downloading an update retrieves its installer from GitHub Releases.
- The Windows installer can download Microsoft Edge WebView2 from Microsoft if that system component is missing.
- Opening GitHub or a model license opens the relevant external website in your browser.

The hosting services receive ordinary connection information, such as your IP address and the file being requested. Their own privacy policies apply: [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), [Hugging Face](https://huggingface.co/privacy), and [Microsoft](https://privacy.microsoft.com/privacystatement).

## Microphone and system integration

Microphone access is controlled by the operating system and the application's permission prompt. Pressing Allow in the app explicitly grants its local WebView microphone permission, including after a previous refusal. It does not change or disable Windows privacy settings; system-level access must still be enabled by the user.

Global shortcuts, clipboard insertion, startup launch, and temporary system audio muting are local features controlled by the app's settings. They do not transmit your input to a server.
