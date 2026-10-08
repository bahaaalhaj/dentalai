"""Versioned YOLOv8 ONNX detection; never downloads or deserializes pickle models."""
import hashlib
import io
import json
import os
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from PIL import Image

POSTPROCESSING_VERSION = "yolov8-onnx-v1"


def letterbox(data: bytes, size: int):
    with Image.open(io.BytesIO(data)) as image:
        if image.format not in ("PNG", "JPEG") or getattr(image, "n_frames", 1) != 1:
            raise ValueError("Unsupported image")
        width, height = image.size
        if not (16 <= width <= 8192 and 16 <= height <= 8192) or width * height > 32 * 1024 * 1024:
            raise ValueError("Image dimensions exceed limit")
        image.load()
        scale = min(size / width, size / height)
        resized = image.convert("RGB").resize((round(width * scale), round(height * scale)), Image.Resampling.BILINEAR)
        left = (size - resized.width) // 2
        top = (size - resized.height) // 2
        canvas = Image.new("RGB", (size, size), (114, 114, 114))
        canvas.paste(resized, (left, top))
        tensor = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
        return tensor, scale, left, top, width, height


def overlap(a, b):
    x = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    y = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    intersection = x * y
    return intersection / (a[2] * a[3] + b[2] * b[3] - intersection) if intersection else 0.0


class Runtime:
    def __init__(self, manifest_path: str):
        manifest_file = Path(manifest_path).resolve(strict=True)
        self.manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        m = self.manifest
        required = ("modelName", "modelVersion", "artifactSha256", "classMap", "inputSize", "confidenceThreshold", "iouThreshold", "artifact", "license", "provenance")
        if any(key not in m for key in required) or any(not m[key] for key in ("license", "provenance", "modelName", "modelVersion")):
            raise ValueError("Incomplete reviewed model provenance")
        if m.get("purpose") == "pipeline_fixture" and os.environ.get("AI_ENV") != "test":
            raise ValueError("Test fixture cannot be loaded outside tests")
        if m.get("purpose") != "pipeline_fixture" and m.get("approvedForExperimentalUse") is not True:
            raise ValueError("Model artifact has not been approved for experimental use")
        artifact = (manifest_file.parent / m["artifact"]).resolve(strict=True)
        if artifact.suffix != ".onnx" or hashlib.sha256(artifact.read_bytes()).hexdigest() != m["artifactSha256"]:
            raise ValueError("Model checksum mismatch")
        graph = onnx.load(str(artifact), load_external_data=False)
        stochastic = {'RandomNormal', 'RandomNormalLike', 'RandomUniform', 'RandomUniformLike', 'Bernoulli', 'Multinomial', 'Dropout'}
        if graph.functions or any(node.op_type in stochastic for node in graph.graph.node):
            raise ValueError('Stochastic operators and local model functions are not supported')
        tensors = list(graph.graph.initializer)
        for node in graph.graph.node:
            for attribute in node.attribute:
                if attribute.type == onnx.AttributeProto.TENSOR:
                    tensors.append(attribute.t)
                if attribute.type == onnx.AttributeProto.TENSORS:
                    tensors.extend(attribute.tensors)
        if graph.graph.sparse_initializer or any(t.data_location == onnx.TensorProto.EXTERNAL or t.external_data for t in tensors):
            raise ValueError("External unchecksummed model weights are not allowed")
        if any(node.domain not in ("", "ai.onnx") or any(attribute.type in (onnx.AttributeProto.GRAPH, onnx.AttributeProto.GRAPHS) for attribute in node.attribute) for node in graph.graph.node):
            raise ValueError("Custom operators and control-flow exports are not supported")
        onnx.checker.check_model(graph)
        if not isinstance(m["classMap"], list) or not 1 <= len(m["classMap"]) <= 100 or any(not isinstance(c,str) or not c for c in m["classMap"]):
            raise ValueError("Invalid class map")
        if not isinstance(m["inputSize"], int) or not 32 <= m["inputSize"] <= 1280 or m["inputSize"] % 32:
            raise ValueError("Invalid model input size")
        if not 0 < m["confidenceThreshold"] < 1 or not 0 < m["iouThreshold"] < 1:
            raise ValueError("Invalid model thresholds")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(artifact), sess_options=options, providers=["CPUExecutionProvider"])
        inputs = self.session.get_inputs()
        if len(inputs) != 1 or inputs[0].type != "tensor(float)" or inputs[0].shape != [1, 3, m["inputSize"], m["inputSize"]]:
            raise ValueError("Only static YOLOv8 detect ONNX inputs are supported")
        self.input_name = inputs[0].name
        self._output(self.session.run(None, {self.input_name: np.zeros(inputs[0].shape, dtype=np.float32)}))

    def _output(self, outputs):
        if len(outputs) != 1:
            raise ValueError("Unsupported model outputs")
        output = outputs[0]
        if output.ndim != 3 or output.shape[0] != 1 or output.shape[1] != 4 + len(self.manifest["classMap"]) or not 1 <= output.shape[2] <= 30000 or not np.isfinite(output).all():
            raise ValueError("Invalid YOLOv8 raw output")
        if ((output[:, 4:, :] < 0) | (output[:, 4:, :] > 1)).any():
            raise ValueError("Model confidence values outside [0,1]")
        return output[0].T

    def infer(self, data: bytes):
        started = time.perf_counter()
        m = self.manifest
        tensor, scale, left, top, width, height = letterbox(data, m["inputSize"])
        output = self._output(self.session.run(None, {self.input_name: tensor}))
        raw = []
        for row in output:
            class_id = int(np.argmax(row[4:]))
            score = float(row[4 + class_id])
            x1 = max(0.0, min(float(width), (float(row[0]) - float(row[2]) / 2 - left) / scale))
            y1 = max(0.0, min(float(height), (float(row[1]) - float(row[3]) / 2 - top) / scale))
            x2 = max(0.0, min(float(width), (float(row[0]) + float(row[2]) / 2 - left) / scale))
            y2 = max(0.0, min(float(height), (float(row[1]) + float(row[3]) / 2 - top) / scale))
            if x2 <= x1 or y2 <= y1:
                continue
            raw.append({"classId": class_id, "score": score, "box": [x1, y1, x2 - x1, y2 - y1]})
        candidates = sorted((d for d in raw if d["score"] >= m["confidenceThreshold"]), key=lambda d: (-d["score"], d["classId"], tuple(d["box"])))
        detections = []
        for detection in candidates:
            if not any(d["classId"] == detection["classId"] and overlap(d["box"], detection["box"]) > m["iouThreshold"] for d in detections):
                detections.append(detection)
            if len(detections) >= 1000:
                break
        return {"modelName": m["modelName"], "modelVersion": m["modelVersion"], "artifactSha256": m["artifactSha256"],
                "imageSha256": hashlib.sha256(data).hexdigest(), "classMap": m["classMap"], "confidenceThreshold": m["confidenceThreshold"],
                "iouThreshold": m["iouThreshold"], "postprocessingVersion": POSTPROCESSING_VERSION,
                "latencyMs": (time.perf_counter() - started) * 1000, "rawPredictions": output.tolist(), "rawDetections": raw, "detections": detections}
