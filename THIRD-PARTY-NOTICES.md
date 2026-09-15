# Third-Party Notices

Vokeyra source code is licensed separately under the MIT License in `LICENSE`. Speech models, converted model files, and runtime components remain subject to their respective licenses below. Model packages are downloaded only after the user selects them. Vokeyra verifies every downloaded artifact against the size and SHA-256 digest recorded in `resources/models.json`.

## OpenAI Whisper and whisper.cpp

- Original model and authors: OpenAI Whisper, https://github.com/openai/whisper
- Model license: MIT, https://github.com/openai/whisper/blob/main/LICENSE
- GGML model conversion source: ggerganov/whisper.cpp at revision `5359861c739e955e79d9a303bcbc70fb988958b1`, https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1
- Runtime: whisper.cpp, https://github.com/ggml-org/whisper.cpp
- Runtime license: MIT. A copy is distributed as `Whisper.cpp-LICENSE.txt`.

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

## Moonshine Tiny English

- Original model and authors: Moonshine AI / Useful Sensors, https://github.com/moonshine-ai/moonshine
- License for the English-language model: MIT, https://github.com/moonshine-ai/moonshine/blob/main/LICENSE
- ONNX INT8 conversion source at revision `bf2b762c076d8ea61e2af0b3851c9564fb77552e`: https://huggingface.co/csukuangfj/sherpa-onnx-moonshine-tiny-en-int8/tree/bf2b762c076d8ea61e2af0b3851c9564fb77552e

Vokeyra uses the English-language Tiny model converted to ONNX and quantized to INT8. It does not use Moonshine models for other languages. Vokeyra does not retrain the model.

## Runtime components

- sherpa-onnx — Apache License 2.0, https://github.com/k2-fsa/sherpa-onnx. A copy is distributed as `Sherpa-ONNX-LICENSE.txt`.
- ONNX Runtime — MIT License, https://github.com/microsoft/onnxruntime. A copy is distributed as `ONNX-Runtime-LICENSE.txt`.

The dependency packages bundled by Electron retain their own copyright and license notices.
