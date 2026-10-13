import { z } from 'zod';

export const MAX_INFERENCE_BYTES = 512 * 1024;
export const MAX_DETECTIONS = 1000;

export const ImagingReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export const ImagingReviewSchema = ImagingReasonSchema.extend({
  decision: z.enum(['confirmed', 'rejected']),
});
export const DetectionSchema = z
  .object({
    classId: z.number().int().nonnegative(),
    score: z.number().min(0).max(1),
    box: z.tuple([
      z.number().nonnegative(),
      z.number().nonnegative(),
      z.number().positive(),
      z.number().positive(),
    ]),
  })
  .strict();
export const InferenceSchema = z
  .object({
    modelName: z.string().min(1).max(150),
    modelVersion: z.string().min(1).max(150),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    classMap: z.array(z.string().min(1).max(150)).min(1).max(100),
    confidenceThreshold: z.number().min(0).max(1),
    iouThreshold: z.number().min(0).max(1),
    latencyMs: z.number().nonnegative(),
    postprocessingVersion: z.literal('yolov8-onnx-v1'),
    responseVersion: z.literal('detections-v2'),
    detections: z.array(DetectionSchema).max(MAX_DETECTIONS),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.detections.some(
        (d) =>
          d.classId >= value.classMap.length ||
          d.box[0] + d.box[2] > 8192 ||
          d.box[1] + d.box[3] > 8192,
      )
    )
      context.addIssue({ code: 'custom', message: 'Unknown model class' });
    if (BufferlessByteLength(JSON.stringify(value)) > MAX_INFERENCE_BYTES)
      context.addIssue({
        code: 'custom',
        message: 'Inference response exceeds compact payload limit',
      });
  });

const BufferlessByteLength = (value: string) => new TextEncoder().encode(value).length;
/** Legacy rows remain immutable in storage. Projection omits raw tensors, never changes detections. */
export function projectHistoricalInference(value: unknown): z.infer<typeof InferenceSchema> {
  const record = z.record(z.string(), z.unknown()).parse(value);
  const {
    rawPredictions: _raw,
    rawDetections: _candidates,
    detectionCount: _count,
    ...metadata
  } = record;
  return InferenceSchema.parse({ ...metadata, responseVersion: 'detections-v2' });
}
export const ImagingImageSchema = z.object({
  id: z.uuid(),
  studyId: z.uuid(),
  version: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  size: z.number().int().positive(),
  contentType: z.enum(['image/png', 'image/jpeg']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string(),
});
export const ImagingRunSchema = z.object({
  id: z.uuid(),
  imageId: z.uuid(),
  status: z.enum(['running', 'succeeded', 'failed']),
  reviewState: z.enum(['draft', 'confirmed', 'rejected']),
  result: InferenceSchema.nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
});
export const ImagingHistorySchema = z.object({
  images: z.array(ImagingImageSchema),
  analyses: z.array(ImagingRunSchema),
});
export type InferenceResult = z.infer<typeof InferenceSchema>;
export type ImagingHistory = z.infer<typeof ImagingHistorySchema>;
export const ImagingCapabilitiesSchema = z
  .object({
    storageConfigured: z.boolean(),
    inferenceConfigured: z.boolean(),
    clinicallyValidated: z.literal(false),
  })
  .strict();
export const imagingContracts = [
  {
    method: 'post',
    path: '/api/v1/imaging/patients/{id}/images',
    public: false,
    params: z.object({ id: z.uuid() }).strict(),
    query: z.object({ studyId: z.uuid().optional() }).strict(),
    response: ImagingImageSchema,
    successStatus: 201,
    binaryUpload: true,
  },
  {
    method: 'get',
    path: '/api/v1/imaging/images/{id}/content',
    public: false,
    params: z.object({ id: z.uuid() }).strict(),
    response: z.string(),
    binaryResponse: true,
  },
  {
    method: 'get',
    path: '/api/v1/imaging/capabilities',
    public: false,
    response: ImagingCapabilitiesSchema,
  },
  {
    method: 'get',
    path: '/api/v1/imaging/patients/{id}',
    public: false,
    params: z.object({ id: z.uuid() }).strict(),
    response: ImagingHistorySchema,
  },
  {
    method: 'post',
    path: '/api/v1/imaging/images/{id}/analyses',
    public: false,
    params: z.object({ id: z.uuid() }).strict(),
    body: ImagingReasonSchema,
    response: ImagingRunSchema,
  },
  {
    method: 'post',
    path: '/api/v1/imaging/analyses/{id}/review',
    public: false,
    params: z.object({ id: z.uuid() }).strict(),
    body: ImagingReviewSchema,
    response: z.object({ success: z.literal(true) }),
  },
] as const;
