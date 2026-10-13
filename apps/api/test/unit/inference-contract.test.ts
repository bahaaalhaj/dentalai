import { describe, it, expect, vi } from 'vitest';
import { InferenceSchema, MAX_DETECTIONS, projectHistoricalInference } from '@dentalai/contracts';
import { PrivateInferenceClient } from '../../src/domains/imaging/inference.js';
import { checksum } from '../../src/domains/imaging/image-validation.js';
const image = Buffer.from('synthetic');
const result = () => ({
  responseVersion: 'detections-v2',
  modelName: 'nonclinical-test',
  modelVersion: 'test',
  artifactSha256: 'a'.repeat(64),
  imageSha256: checksum(image),
  classMap: ['test'],
  confidenceThreshold: 0.5,
  iouThreshold: 0.5,
  latencyMs: 1,
  postprocessingVersion: 'yolov8-onnx-v1',
  detections: [] as { classId: number; score: number; box: number[] }[],
});
describe('compact versioned inference', () => {
  it('fails safely when the inference request exceeds its deadline', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          signal?.addEventListener('abort', () => reject(new Error('private transport details')), {
            once: true,
          });
        }),
    );
    try {
      await expect(
        new PrivateInferenceClient('http://localhost:8000', 'local-test', 20).infer(image),
      ).rejects.toMatchObject({ code: 'INFERENCE_UNAVAILABLE', statusCode: 503 });
    } finally {
      fetchMock.mockRestore();
    }
  });
  it('accepts the maximum bounded compact count and rejects invalid/excessive data', () => {
    const valid = result();
    valid.detections = Array.from({ length: MAX_DETECTIONS }, () => ({
      classId: 0,
      score: 0.9,
      box: [0, 0, 10, 10],
    }));
    expect(InferenceSchema.parse(valid).detections).toHaveLength(MAX_DETECTIONS);
    expect(
      InferenceSchema.safeParse({
        ...valid,
        detections: [...valid.detections, valid.detections[0]],
      }).success,
    ).toBe(false);
    for (const patch of [
      { rawPredictions: [[1, 2, 3, 4, 0.9]] },
      { detections: [{ classId: 1, score: 0.9, box: [0, 0, 1, 1] }] },
      { detections: [{ classId: 0, score: NaN, box: [0, 0, 1, 1] }] },
      { modelName: 'x'.repeat(600000) },
    ])
      expect(InferenceSchema.safeParse({ ...result(), ...patch }).success).toBe(false);
  });
  it('projects immutable historical results without leaking raw outputs or fabricating detections', () => {
    const current = result();
    const { responseVersion: _version, ...legacy } = current;
    expect(
      projectHistoricalInference({ ...legacy, rawPredictions: [[1, 2, 3]], rawDetections: [] }),
    ).toEqual(current);
  });
  it('rejects excessive streamed responses, malformed results and unavailable service with safe errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    try {
      for (const response of [
        new Response('x'.repeat(512 * 1024 + 1)),
        new Response(JSON.stringify({ ...result(), rawPredictions: [] })),
        new Response('{}'),
        new Response('', { status: 503 }),
      ]) {
        fetchMock.mockResolvedValueOnce(response);
        await expect(
          new PrivateInferenceClient('http://localhost:8000', 'local-test').infer(image),
        ).rejects.toMatchObject({ code: 'INFERENCE_UNAVAILABLE' });
      }
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(result())));
      expect(
        await new PrivateInferenceClient('http://localhost:8000', 'local-test').infer(image),
      ).toEqual(result());
    } finally {
      fetchMock.mockRestore();
    }
  });
});
