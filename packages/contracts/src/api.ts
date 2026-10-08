import { z } from 'zod';
import { accessContracts } from './auth.js';
import { appointmentContracts } from './appointments.js';
import { clinicalContracts } from './clinical.js';
import { billingContracts } from './billing.js';
import {
  HealthCheckRequestSchema,
  LivenessResponseSchema,
  ReadinessResponseSchema,
} from './health.js';

export const ApiVersionSchema = z.literal('v1');

export const ErrorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    details: z.array(ErrorDetailSchema).optional(),
  }),
});

export const ContractDocumentParamsSchema = z
  .object({
    version: ApiVersionSchema,
  })
  .strict();

export const ContractDocumentQuerySchema = z
  .object({
    format: z.literal('openapi').default('openapi'),
  })
  .strict();

export const OpenApiDocumentSchema = z
  .object({
    openapi: z.literal('3.1.0'),
    info: z.object({
      title: z.string(),
      version: z.string(),
    }),
    paths: z.record(z.string(), z.unknown()),
  })
  .passthrough();

function jsonContent(schema: z.ZodType) {
  return {
    'application/json': {
      schema: z.toJSONSchema(schema, { target: 'draft-2020-12' }),
    },
  };
}

export function createOpenApiDocument() {
  const errorResponse = {
    description: 'Safe API error',
    content: jsonContent(ApiErrorResponseSchema),
  };

  const accessPaths: Record<string, Record<string, unknown>> = {};
  for (const contract of [
    ...accessContracts,
    ...appointmentContracts,
    ...clinicalContracts,
    ...billingContracts,
  ]) {
    const operation = {
      security: contract.public ? [] : [{ cookieSession: [] }],
      ...('body' in contract
        ? { requestBody: { required: true, content: jsonContent(contract.body) } }
        : {}),
      ...('params' in contract || 'query' in contract
        ? {
            parameters: [
              ...('params' in contract
                ? [
                    {
                      in: 'path',
                      name: 'id',
                      required: true,
                      schema: z.toJSONSchema(contract.params.shape.id),
                    },
                  ]
                : []),
              ...('query' in contract
                ? Object.entries(contract.query.shape).map(([name, schema]) => ({
                    in: 'query',
                    name,
                    required: !schema.isOptional(),
                    schema: z.toJSONSchema(schema),
                  }))
                : []),
            ],
          }
        : {}),
      responses: {
        '200': { description: 'Validated response', content: jsonContent(contract.response) },
        '400': errorResponse,
        '401': errorResponse,
        '403': errorResponse,
        '404': errorResponse,
        '409': errorResponse,
        '422': errorResponse,
      },
    };
    accessPaths[contract.path] = { ...accessPaths[contract.path], [contract.method]: operation };
  }
  return {
    openapi: '3.1.0' as const,
    info: {
      title: 'DentalAI API',
      version: '1.0.0',
      description:
        'Backend authentication, clinic access, scheduling, and versioned clinical-record workflows. Experimental AI remains unavailable.',
    },
    paths: {
      ...accessPaths,
      '/api/v1/health/live': {
        get: {
          operationId: 'getLiveness',
          responses: {
            '200': {
              description: 'The API process is alive',
              content: jsonContent(LivenessResponseSchema),
            },
            '400': errorResponse,
          },
        },
      },
      '/api/v1/health/ready': {
        get: {
          operationId: 'getReadiness',
          responses: {
            '200': {
              description: 'The API is ready to receive traffic',
              content: jsonContent(ReadinessResponseSchema),
            },
            '503': {
              description: 'A required dependency is unavailable or the process is draining',
              content: jsonContent(ReadinessResponseSchema),
            },
          },
        },
      },
      '/api/v1/contracts/{version}': {
        get: {
          operationId: 'getOpenApiContract',
          parameters: [
            {
              name: 'version',
              in: 'path',
              required: true,
              schema: z.toJSONSchema(ApiVersionSchema, { target: 'draft-2020-12' }),
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: z.toJSONSchema(ContractDocumentQuerySchema.shape.format, {
                target: 'draft-2020-12',
              }),
            },
          ],
          responses: {
            '200': {
              description: 'OpenAPI generated from the shared Zod contracts',
              content: jsonContent(OpenApiDocumentSchema),
            },
            '400': errorResponse,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        cookieSession: { type: 'apiKey', in: 'cookie', name: '__Secure-dentalai.session_token' },
      },
      schemas: {
        HealthCheckRequest: z.toJSONSchema(HealthCheckRequestSchema, {
          target: 'draft-2020-12',
        }),
        ApiError: z.toJSONSchema(ApiErrorResponseSchema, { target: 'draft-2020-12' }),
      },
    },
  };
}

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type ContractDocumentParams = z.infer<typeof ContractDocumentParamsSchema>;
export type ContractDocumentQuery = z.infer<typeof ContractDocumentQuerySchema>;
export type OpenApiDocument = z.infer<typeof OpenApiDocumentSchema>;
