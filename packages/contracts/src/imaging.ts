import { z } from 'zod';

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
    modelName: z.string().min(1),
    modelVersion: z.string().min(1),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    classMap: z.array(z.string().min(1)).min(1).max(100),
    confidenceThreshold: z.number().min(0).max(1),
    iouThreshold: z.number().min(0).max(1),
    latencyMs: z.number().nonnegative(),
    postprocessingVersion: z.literal('yolov8-onnx-v1'),
    rawDetections: z.array(DetectionSchema).max(30000),
    rawPredictions: z.array(z.array(z.number()).min(5).max(104)).max(30000),
    detections: z.array(DetectionSchema).max(1000),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.rawPredictions.some(
        (row) =>
          row.length !== 4 + value.classMap.length ||
          row.slice(4).some((score) => score < 0 || score > 1),
      )
    )
      context.addIssue({ code: 'custom', message: 'Invalid raw model output' });
    if (
      [...value.rawDetections, ...value.detections].some((d) => d.classId >= value.classMap.length)
    )
      context.addIssue({ code: 'custom', message: 'Unknown model class' });
  });
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
