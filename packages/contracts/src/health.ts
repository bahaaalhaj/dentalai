import { z } from 'zod';

export const HealthCheckRequestSchema = z.object({}).strict();

export const LivenessResponseSchema = z.object({
  service: z.literal('api'),
  status: z.literal('ok'),
  version: z.literal('v1'),
  timestamp: z.iso.datetime(),
});

export const ReadinessResponseSchema = z.object({
  service: z.literal('api'),
  status: z.enum(['ready', 'not_ready']),
  version: z.literal('v1'),
  timestamp: z.iso.datetime(),
  checks: z.object({
    database: z.enum(['ok', 'error']),
    lifecycle: z.enum(['accepting_traffic', 'draining']),
  }),
});

/** @deprecated Use LivenessResponseSchema for the versioned endpoint. */
export const ApiHealthResponseSchema = LivenessResponseSchema;

export type HealthCheckRequest = z.infer<typeof HealthCheckRequestSchema>;
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
export type ApiHealthResponse = LivenessResponse;
