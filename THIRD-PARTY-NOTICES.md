# Third-Party Notices

Vokeyra source code is licensed separately under the MIT License in `LICENSE`. Speech models, converted model files, and runtime components remain subject to their respective licenses below. Model packages are downloaded only after the user selects them. Vokeyra verifies every downloaded artifact against the size and SHA-256 digest recorded in `resources/models.json`.

## OpenAI Whisper and whisper.cpp

- Original model and authors: OpenAI Whisper, https://github.com/openai/whisper
- Model license: MIT, https://github.com/openai/whisper/blob/main/LICENSE
- GGML model conversion source: ggerganov/whisper.cpp at revision `5359861c739e955e79d9a303bcbc70fb988958b1`, https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1
- Runtime: whisper.cpp, https://github.com/ggml-org/whisper.cpp
- Runtime license: MIT. A copy is distributed as `Whisper.cpp-LICENSE.txt`.
- Linux runtime source: whisper.cpp 1.8.3, commit `2eeeba56e9edd762b4b38467bab96c2517163158`, https://github.com/ggml-org/whisper.cpp/tree/2eeeba56e9edd762b4b38467bab96c2517163158. The build verifies the source archive SHA-256 before compiling; the upstream license is also included next to the Linux executable.

Vokeyra uses the published GGML files, including quantized variants identified in the catalog. Vokeyra does not retrain these models.

## GigaAM

- Original model and authors: GigaAM by Salute Developers, https://github.com/salute-developers/GigaAM
- License: MIT, https://github.com/salute-developers/GigaAM/blob/main/LICENSE
- GigaAM v3 E2E CTC ONNX INT8 source at revision `322c3b29492673eb7d0b434bfa9dfb8653e34d02`: https://huggingface.co/istupakov/gigaam-v3-onnx/tree/322c3b29492673eb7d0b434bfa9dfb8653e34d02
- GigaAM v3 E2E RNNT sherpa-onnx/INT8 source at revision `c0acd38c8aeb2bdc04da221bd661ffcdb9645f7d`: https://huggingface.co/Alexxerm/gigaam-v3-e2e-rnnt-sherpa-onnx/tree/c0acd38c8aeb2bdc04da221bd661ffcdb9645f7d
- GigaAM Multilingual CTC ONNX INT8 source at revision `458860e1983aef670dd9795fb6af603c82767d5d`: https://huggingface.co/istupakov/gigaam-multilingual-ctc-onnx/tree/458860e1983aef670dd9795fb6af603c82767d5d

These packages are ONNX exports and/or INT8 quantized conversions of the original models. Vokeyra does not retrain them. A copy of the MIT license is distributed as `GigaAM-LICENSE.txt`.

## NVIDIA Parakeet TDT 0.6B v3

- Original model and author: NVIDIA Parakeet TDT 0.6B v3, © NVIDIA Corporation, https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- License: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
- ONNX INT8 conversion source at revision `2bda32ec70b097a55adaa07d9a7173915b43cc78`: https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/tree/2bda32ec70b097a55adaa07d9a7173915b43cc78

The files offered by Vokeyra are converted to ONNX and quantized to INT8 from the original NVIDIA model. Vokeyra does not retrain the model. No endorsement by NVIDIA is implied.

## Moonshine Tiny and Base English

- Original model and authors: Moonshine AI / Useful Sensors, https://github.com/moonshine-ai/moonshine
- License for the English-language model: MIT, https://github.com/moonshine-ai/moonshine/blob/main/LICENSE
- ONNX INT8 conversion source at revision `bf2b762c076d8ea61e2af0b3851c9564fb77552e`: https://huggingface.co/csukuangfj/sherpa-onnx-moonshine-tiny-en-int8/tree/bf2b762c076d8ea61e2af0b3851c9564fb77552e
- Base ONNX INT8 conversion at revision `052b0798ad1bf046a140fdd4efcd9426530fa3f5`: https://huggingface.co/csukuangfj/sherpa-onnx-moonshine-base-en-int8/tree/052b0798ad1bf046a140fdd4efcd9426530fa3f5

Vokeyra uses the English-language Tiny and Base models converted to ONNX and quantized to INT8. It does not use Moonshine models for other languages. Vokeyra does not retrain these models.

## Vosk Small Russian and Zipformer GigaSpeech English

- Vosk Small Russian: Alpha Cephei, Apache License 2.0, https://huggingface.co/alphacep/vosk-model-small-ru/tree/4d68c4017bcfa44e2a79581f7933339e916a35da
- Zipformer GigaSpeech: k2-fsa / icefall, Apache License 2.0, https://huggingface.co/csukuangfj/sherpa-onnx-zipformer-gigaspeech-2023-12-12/tree/a2a62c509c99b336186e16e5bbd19d3828954875
- License text: https://www.apache.org/licenses/LICENSE-2.0

These are Zipformer transducer models, downloaded as the published ONNX INT8 files. Vokeyra does not retrain them. Files from the Vosk `am` and `lang` directories are stored together in the local model directory without changing their contents.

## SenseVoice Small

- Original model and authors: Alibaba / FunAudioLLM, https://huggingface.co/FunAudioLLM/SenseVoiceSmall
- Weights license: FunASR Model Open Source License Agreement, https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE. A copy is distributed as `SenseVoice-Model-LICENSE.txt`.
- ONNX INT8 conversion: https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07

The model weights have their own license, separate from the MIT license of Vokeyra and the SenseVoice runtime code. Vokeyra uses the published converted and quantized weights without retraining. This conversion supports Mandarin, Cantonese, English, Japanese, and Korean; recognition of emotions or audio events is not exposed by Vokeyra.

## Distil-Whisper Large v3

- Original model and authors: Hugging Face Distil-Whisper, based on OpenAI Whisper Large v3, https://huggingface.co/distil-whisper/distil-large-v3
- License: MIT, https://github.com/huggingface/distil-whisper/blob/main/LICENSE. A copy is distributed as `Distil-Whisper-LICENSE.txt`.
- GGML F16 conversion published by the model authors: https://huggingface.co/distil-whisper/distil-large-v3-ggml/tree/0d78dd96ed9fc152325f63b53788fec3b43de031

Vokeyra uses the published GGML file without retraining. This checkpoint supports English recognition only.

## Runtime components

- sherpa-onnx — Apache License 2.0, https://github.com/k2-fsa/sherpa-onnx. A copy is distributed as `Sherpa-ONNX-LICENSE.txt`.
- ONNX Runtime — MIT License, https://github.com/microsoft/onnxruntime. A copy is distributed as `ONNX-Runtime-LICENSE.txt`.
- Tauri — MIT OR Apache-2.0, https://github.com/tauri-apps/tauri. The MIT license is distributed as `Tauri-LICENSE.txt`.
- Node.js — MIT and bundled third-party licenses, https://github.com/nodejs/node. The full license and notices are distributed as `Node-LICENSE.txt`.

Dependency packages retain their own copyright and license notices. Vokeyra uses the system WebView; Electron and Chromium are not bundled.
