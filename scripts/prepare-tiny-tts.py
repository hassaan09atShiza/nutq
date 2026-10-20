"""Splits the tiny-tts model into three ONNX files and pre-optimizes each, so the browser creates its sessions faster.

The single tinytts.onnx takes 3 to 6 s to load in ONNX Runtime Web (eval/tts/README.md): almost all of it is ONNX
Runtime planning memory for a graph of about 9,900 nodes, and ONNX Runtime Web cannot turn memory reuse off. Three
smaller graphs (text encoder and duration predictor, flow, decoder), each with ONNX Runtime's "basic" optimizations
(constant folding and redundant node removal, plain ONNX operators only, so the files stay portable) applied ahead
of time, load several times faster. With the noise scales at 0, the three parts give the same samples as the
original (checked here).

    python3 -m venv .venv-tts && .venv-tts/bin/pip install onnx==1.23.2 onnxruntime==1.29.0 numpy
    .venv-tts/bin/python scripts/prepare-tiny-tts.py

Reads local-assets/tiny-tts/tinytts.onnx (scripts/fetch-tiny-tts.mjs) and writes tinytts.p1.onnx, tinytts.p2.onnx and
tinytts.p3.onnx next to it. The outputs are derived from the model, so they are as unlicensed as it is: local only.
"""

import hashlib
import os
import sys

import numpy as np
import onnx
import onnxruntime as ort
from onnx.utils import Extractor

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "local-assets", "tiny-tts")
SOURCE = os.path.join(DIR, "tinytts.onnx")
SOURCE_SHA256 = "2a12614685c76597d3eeec6772f2c9ce132001cf6ea8a80609f8db9fd7fb745f"

# Tensor names at the cuts, from the graph exported at Hugging Face revision 6d0cc90: the flow's inputs (prior sample,
# frame mask, and two speaker conditionings), the masked latent that enters the decoder, and the decoder's conditioning.
FLOW_IN = ["/Add_1_output_0", "/Cast_2_output_0", "/Unsqueeze_4_output_0", "/enc_p/encoder/Transpose_output_0"]
DEC_IN = ["/Mul_8_output_0", "/Unsqueeze_output_0"]


def main():
    with open(SOURCE, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != SOURCE_SHA256:
        sys.exit(f"{SOURCE}: SHA-256 {digest}, expected {SOURCE_SHA256}; run scripts/fetch-tiny-tts.mjs")
    model = onnx.shape_inference.infer_shapes(onnx.load(SOURCE))
    inputs = [i.name for i in model.graph.input]
    ex = Extractor(model)
    parts = {
        "p1": ex.extract_model(inputs, FLOW_IN + [DEC_IN[1]]),
        "p2": ex.extract_model(FLOW_IN, [DEC_IN[0]]),
        "p3": ex.extract_model(DEC_IN, ["audio"]),
    }
    for name, part in parts.items():
        raw = os.path.join(DIR, f"tinytts.{name}.raw.onnx")
        out = os.path.join(DIR, f"tinytts.{name}.onnx")
        onnx.save(part, raw)
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
        opts.optimized_model_filepath = out
        ort.InferenceSession(raw, opts, providers=["CPUExecutionProvider"])
        os.remove(raw)
        # Keep the IR version of the export, so an older ONNX Runtime Web reads the file too.
        saved = onnx.load(out)
        saved.ir_version = model.ir_version
        onnx.save(saved, out)
        with open(out, "rb") as f:
            print(f"wrote {out} ({len(saved.graph.node)} nodes, sha256 {hashlib.sha256(f.read()).hexdigest()})")

    # Same samples as the original with the noise off (it is random otherwise).
    t = 61
    rng = np.random.default_rng(0)
    feeds = {
        "x": rng.integers(1, 200, (1, t)).astype(np.int64), "x_lengths": np.array([t], np.int64), "sid": np.array([0], np.int64),
        "tone": np.full((1, t), 8, np.int64), "language": np.full((1, t), 2, np.int64),
        "bert": np.zeros((1, 1024, t), np.float32), "ja_bert": np.zeros((1, 768, t), np.float32),
        "noise_scale": np.array([0.0], np.float32), "noise_scale_w": np.array([0.0], np.float32), "length_scale": np.array([1.0], np.float32),
    }
    expected = ort.InferenceSession(SOURCE, providers=["CPUExecutionProvider"]).run(None, feeds)[0]
    env = dict(feeds)
    for name in parts:
        s = ort.InferenceSession(os.path.join(DIR, f"tinytts.{name}.onnx"), providers=["CPUExecutionProvider"])
        env.update(zip([o.name for o in s.get_outputs()], s.run(None, {i.name: env[i.name] for i in s.get_inputs()})))
    got = env["audio"]
    diff = float(np.max(np.abs(expected - got))) if expected.shape == got.shape else float("inf")
    print(f"check: {got.shape[-1]} samples, largest difference from the original {diff}")
    sys.exit(0 if diff < 1e-4 else 1)


if __name__ == "__main__":
    main()
