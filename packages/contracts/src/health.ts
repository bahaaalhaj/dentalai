import { z } from 'zod';

export const HealthCheckRequestSchema = z.object({}).strict();

export const ApiHealthResponseSchema = z.object({
  service: z.literal('api'),
  status: z.literal('ok'),
  timestamp: z.iso.datetime(),
});

export type HealthCheckRequest = z.infer<typeof HealthCheckRequestSchema>;
export type ApiHealthResponse = z.infer<typeof ApiHealthResponseSchema>;
