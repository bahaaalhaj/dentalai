import { z } from 'zod';
import { accessContracts } from './auth.js';
import { appointmentContracts } from './appointments.js';
import { clinicalContracts } from './clinical.js';
import { billingContracts } from './billing.js';
import { imagingContracts } from './imaging.js';
import { authorizationDocumentation } from './authorization-documentation.js';
import { anesthesiaContracts } from './anesthesia.js';
import { administrationContracts, AdministrationExportFileContract } from './administration.js';
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
  accessPaths[AdministrationExportFileContract.path] = {
    get: {
      security: [{ cookieSession: [] }],
      description:
        'Recent owner session required; private attachment, tenant-scoped and checksum-verified.',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: z.toJSONSchema(AdministrationExportFileContract.params.shape.id),
        },
      ],
      responses: {
        '200': {
          description: 'Private file',
          content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
        },
        '401': errorResponse,
        '403': errorResponse,
        '404': errorResponse,
        '503': errorResponse,
      },
    },
  };
  for (const contract of [
    ...accessContracts,
    ...appointmentContracts,
    ...clinicalContracts,
    ...billingContracts,
    ...imagingContracts,
    ...anesthesiaContracts,
    ...administrationContracts,
  ]) {
    const operation = {
      security: ['post', 'patch', 'put', 'delete'].includes(contract.method)
        ? [
            contract.public
              ? { csrfHeader: [], csrfCookie: [] }
              : { cookieSession: [], csrfHeader: [], csrfCookie: [] },
          ]
        : contract.public
          ? []
          : [{ cookieSession: [] }],
      description: authorizationDocumentation(contract.path, contract.method, contract.public),
      ...('binaryUpload' in contract
        ? {
            requestBody: {
              required: true,
              description:
                'Single-frame PNG/JPEG, maximum 10 MiB; magic bytes, dimensions 16–8192, max 32 megapixels and full decode verified. Never public storage.',
              content: {
                'image/png': { schema: { type: 'string', format: 'binary' } },
                'image/jpeg': { schema: { type: 'string', format: 'binary' } },
              },
            },
          }
        : {}),
      ...('body' in contract
        ? { requestBody: { required: true, content: jsonContent(contract.body) } }
        : {}),
      ...('params' in contract ||
      'query' in contract ||
      ['post', 'put', 'patch', 'delete'].includes(contract.method)
        ? {
            parameters: [
              ...(['post', 'put', 'patch', 'delete'].includes(contract.method)
                ? [
                    {
                      in: 'header',
                      name: 'x-csrf-token',
                      required: true,
                      schema: { type: 'string' },
                      description:
                        'Obtain from GET /api/v1/access/csrf and send with its signed HttpOnly cookie and exact configured Origin.',
                    },
                    {
                      in: 'header',
                      name: 'Origin',
                      required: true,
                      schema: { type: 'string', format: 'uri' },
                    },
                  ]
                : []),
              ...('binaryUpload' in contract
                ? [
                    {
                      in: 'header',
                      name: 'x-imaging-reason',
                      required: true,
                      schema: { type: 'string' },
                      description: 'Percent-encoded change reason, 3–500 decoded characters.',
                    },
                  ]
                : []),
              ...(contract.method === 'post' &&
              /\/imaging\/(patients\/\{id\}\/images|images\/\{id\}\/analyses)$/.test(contract.path)
                ? [
                    {
                      in: 'header',
                      name: 'idempotency-key',
                      required: false,
                      schema: { type: 'string', format: 'uuid' },
                      description:
                        'Reuse the same UUID and exact provenance on retries. Completed requests replay their original result; pending/failed keys return 409 and require owner reconciliation or an explicit new logical operation. Omission creates a new operation.',
                    },
                  ]
                : []),
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
        ...('blocked' in contract
          ? {}
          : {
              ['successStatus' in contract ? contract.successStatus : 200]: {
                description: 'Validated response',
                content:
                  'binaryResponse' in contract
                    ? {
                        'image/png': { schema: { type: 'string', format: 'binary' } },
                        'image/jpeg': { schema: { type: 'string', format: 'binary' } },
                      }
                    : jsonContent(contract.response),
              },
            }),
        '400': errorResponse,
        '401': errorResponse,
        '403': errorResponse,
        '404': errorResponse,
        '409': errorResponse,
        '413': errorResponse,
        '415': errorResponse,
        '422': errorResponse,
        '429': errorResponse,
        '503': errorResponse,
        '500': errorResponse,
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
        'Backend authentication, clinic access, scheduling and versioned clinical records. Experimental inference is unavailable by default; explicitly configured private inference remains advisory and requires clinician review. Anesthesia recommendations remain disabled.',
    },
    paths: {
      '/api/v1/auth/verify-email': {
        get: {
          security: [],
          description:
            'Public, single-use email verification link. Requires a valid signed provider token; callback is server-owned and constrained to the configured origin. Redirects to login, never returns a session token. This email-link GET is not a cookie-authenticated mutation and does not use the CSRF header.',
          parameters: [
            {
              in: 'query',
              name: 'token',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 4096 },
            },
          ],
          responses: {
            '302': {
              description: 'Redirect to configured-origin login after verification',
              headers: { Location: { schema: { type: 'string', format: 'uri' } } },
            },
            '400': errorResponse,
            '429': errorResponse,
          },
        },
      },
      '/api/v1/access/csrf': {
        get: {
          security: [],
          description:
            'Issue signed double-submit CSRF cookie and token; not a login session. Use same-origin credentials, then pass x-csrf-token + exact Origin on mutations.',
          responses: {
            '200': {
              description: 'Private/no-store token response',
              content: jsonContent(z.object({ token: z.string() })),
            },
            '429': errorResponse,
          },
        },
      },
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
        csrfHeader: { type: 'apiKey', in: 'header', name: 'x-csrf-token' },
        csrfCookie: { type: 'apiKey', in: 'cookie', name: '__Host-dentalai.csrf' },
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
