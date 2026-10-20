<p align="center">
  <img src="logo/vokeyra-logo.png" alt="Vokeyra" width="260">
</p>

<p align="center">
  Local, private voice typing for Windows and Linux.
</p>

<p align="center">
  <strong>English</strong> · <a href="README.ru.md">Русский</a>
</p>

# Vokeyra

Vokeyra is a free and open-source speech-to-text application for Windows and Linux. Press a keyboard shortcut, speak, and Vokeyra inserts the result into the application you are using.

Recognition runs locally on your computer. Vokeyra has no accounts, cloud transcription, telemetry, subscriptions, or paid API requirements. An internet connection is needed for downloads and update checks.

## Download and install

1. Open the [latest release](../../releases/latest).
2. Download the Windows `.exe` or `.msi` installer.
3. Run the installer and launch Vokeyra.
4. Allow microphone access when Windows asks for it.

The interface uses Microsoft Edge WebView2. The installer downloads this system component if it is missing.

The Windows installer is not yet digitally signed. Windows SmartScreen may display a warning.

The EXE installs for the current user; MSI installs for all users and requires administrator approval. Keep the same format when updating.

For Linux x64, download `.deb` for Ubuntu/Debian, `.rpm` for Fedora, or `.AppImage` for other distributions. Linux support is experimental; see the [Linux guide](docs/LINUX.md) for requirements and limitations.

When upgrading from 0.1.1, download and install 0.3.0 manually. Subsequent updates can be downloaded and installed from the app.

## Your first transcription

1. Open **Models** and choose a model. **Whisper Base** is a good starting point for most users; **GigaAM v3 E2E RNNT** is recommended for Russian.
2. Wait for the model to download and pass its integrity check. It becomes active automatically.
3. Open **Home** to review the language, microphone, and transcription shortcut. The default shortcut is **Ctrl + Shift + Space**.
4. Place the cursor in any text field, press the shortcut, and speak. Press it again to stop recording. You can enable hold-to-record in Home if you prefer.
5. Vokeyra transcribes the recording and inserts the text into the application that was active before recording.

The global shortcut works while the Vokeyra window is minimized. You can also start a recording manually from **History**.

## Features

- Fully local speech recognition with CPU inference.
- 19 models for multilingual dictation, Russian, English, European and East Asian languages, and several Central Asian languages.
- Configurable global shortcut with toggle and hold-to-record modes.
- Automatic text insertion, clipboard handling, and optional automatic submission.
- Microphone and channel selection, recording sounds, and optional system audio muting.
- Local history with audio playback, favorites, copying, deletion, and retranscription.
- Optional punctuation, filler-word removal, custom vocabulary, and a trailing space.
- Word and phrase replacements for every model, configured in Settings → Word replacements.
- Russian and English interface, tray mode, autostart, and two window sizes.

## Models

Models are downloaded only when you select them and are not included in the installer. Download sizes are approximate.

| Model | Languages | Download | Best for |
| --- | ---: | ---: | --- |
| Whisper Tiny Q5_1 | 99+ | 32 MB | The smallest multilingual option |
| Whisper Tiny | 99+ | 78 MB | Fast basic transcription |
| Whisper Base Q5_1 | 99+ | 60 MB | Compact everyday dictation |
| Whisper Base | 99+ | 148 MB | The best general starting point |
| Whisper Small Q5_1 | 99+ | 190 MB | Better accuracy without a large download |
| Whisper Small | 99+ | 488 MB | More accurate multilingual dictation |
| Whisper Medium Q5_0 | 99+ | 539 MB | High multilingual accuracy |
| Whisper Large v3 Turbo Q5_0 | 99+ | 574 MB | High accuracy with reasonable speed |
| Whisper Large v3 Q5_0 | 99+ | 1,081 MB | Maximum Whisper accuracy; slower inference |
| GigaAM v3 E2E CTC | Russian | 225 MB | Accurate Russian transcription |
| GigaAM v3 E2E RNNT | Russian | 226 MB | Fast Russian dictation with punctuation |
| NVIDIA Parakeet TDT 0.6B v3 | 25 European languages | 670 MB | Accurate European-language dictation |
| Moonshine Tiny English | English | 124 MB | Fast and compact English transcription |
| GigaAM Multilingual CTC | RU, KZ, KY, UZ, EN | 225 MB | Russian and Central Asian languages |
| Vosk Small Russian | RU | 27 MB | A lightweight Russian option |
| Zipformer GigaSpeech English | EN | 74 MB | Compact English transcription |
| Moonshine Base English | EN | 287 MB | A larger alternative to Moonshine Tiny |
| SenseVoice Small | ZH, EN, JA, KO, YUE | 240 MB | Mandarin, Cantonese, English, Japanese, and Korean |
| Distil-Whisper Large v3 | EN | 1,520 MB | English transcription based on Whisper Large v3 |

Larger models generally need more memory and take longer to process a recording. You can install several models, switch between them, or remove unused models at any time.

SenseVoice weights use the [FunASR Model License](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE). Other model licenses are listed in the application and [Third-Party Notices](THIRD-PARTY-NOTICES.md).

## System requirements

| | Requirement |
| --- | --- |
| Operating system | Windows 10/11 x64, or Linux x64 (experimental; Ubuntu 22.04 X11 tested) |
| Processor | x64 Intel or AMD processor |
| Hardware | A working microphone; no dedicated GPU required |
| Internet | Required to download the application and selected models |
| Storage | Application files plus 27 MB–1.52 GB for each installed model |

macOS, ARM, and 32-bit builds are not available. On Linux, both X11 and Wayland sessions are supported (with automatic insertion via wtype/ydotool, global shortcuts via swhkd or compositor keybindings, and audio muting via PulseAudio / PipeWire; see the [Linux guide](docs/LINUX.md) for details).

## Privacy and local data

Audio and transcription are processed on your computer. Vokeyra does not upload recordings or transcribed text to an application server and does not collect telemetry. Model files are downloaded from the sources listed in the built-in catalog.

Settings, installed models, recordings, and history are stored in the Vokeyra application-data folder. You can open the data folder and recordings folder from inside the application, and you can delete history entries or models whenever you want.

## Current limitations

- Recognition currently uses the CPU; processing time depends on the selected model and computer.
- The Windows installer is not yet digitally signed.
- Starting with 0.3.0, the update button downloads and installs signed application updates. Updater signatures are separate from Windows installer signing.

## License and acknowledgements

Vokeyra source code is available under the [MIT License](LICENSE). Speech engines and model files keep their own licenses. Attribution, immutable model sources, conversion details, and license links are listed in [Third-Party Notices](THIRD-PARTY-NOTICES.md).

[Privacy policy](PRIVACY.md) · [Code signing policy](docs/CODE_SIGNING.md)

Vokeyra uses or supports work from [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [OpenAI Whisper](https://github.com/openai/whisper), [GigaAM](https://github.com/salute-developers/GigaAM), [NVIDIA Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [Moonshine](https://github.com/moonshine-ai/moonshine), [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), and [ONNX Runtime](https://github.com/microsoft/onnxruntime).
