import { describe, it, expect } from 'vitest';
import { createOpenApiDocument, imagingContracts } from '@dentalai/contracts';
import { createImagingRouter } from '../../src/domains/imaging/imaging.routes.js';
import type { AuthProvider, AuthOptions } from '../../src/domains/auth/auth.provider.js';
import type { AccessRepository } from '../../src/domains/access/access.repository.js';
import type { SystemService } from '../../src/domains/system/system.service.js';
import { createSystemRouter } from '../../src/domains/system/system.routes.js';
import { createAuthRouter } from '../../src/domains/auth/auth.routes.js';
import { createAccessRouter } from '../../src/domains/access/access.routes.js';
import { createAdministrationRouter } from '../../src/domains/administration/administration.routes.js';
import { createAnesthesiaRouter } from '../../src/domains/anesthesia/anesthesia.routes.js';
import { createSchedulingRouter } from '../../src/domains/scheduling/scheduling.routes.js';
import { createClinicalRouter } from '../../src/domains/clinical/clinical.routes.js';
import { createBillingRouter } from '../../src/domains/billing/billing.routes.js';
import type { Router } from 'express';
function registered(router: Router, prefix = '/api/v1') {
  return (
    router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }
  ).stack.flatMap((layer) =>
    layer.route
      ? Object.keys(layer.route.methods).map(
          (method) => `${method} ${prefix}${layer.route!.path.replace(/:([a-z]+)/g, '{$1}')}`,
        )
      : [],
  );
}
describe('actual route and OpenAPI parity', () => {
  it('all implemented domain routers match OpenAPI; only explicitly named health/monitoring aliases are internal exceptions', () => {
    const auth = {} as AuthProvider,
      access = { pool: {} } as AccessRepository,
      options = {} as AuthOptions;
    const paths = createOpenApiDocument().paths;
    const actual = [
      ...registered(createSystemRouter({} as SystemService)),
      ...registered(createAuthRouter(auth, access, options), '/api/v1/auth'),
      ...registered(createAccessRouter(auth, access, options), '/api/v1/access'),
      ...registered(createAdministrationRouter(auth, access, options)),
      ...registered(createAnesthesiaRouter(auth, access)),
      ...registered(createImagingRouter(auth, access)),
      ...registered(createSchedulingRouter(auth, access)),
      ...registered(createClinicalRouter(auth, access)),
      ...registered(createBillingRouter(auth, access)),
      'get /api/v1/access/csrf',
    ];
    const documented = Object.entries(paths).flatMap(([path, operations]) =>
      Object.keys(operations).map((method) => `${method} ${path}`),
    );
    expect(actual.sort()).toEqual(documented.sort());
    // /api/health is the deliberate legacy alias; metrics/monitoring run on their private listener.
    expect(paths).not.toHaveProperty('/api/health');
  });
  it('documents every registered imaging route, including upload and authenticated content', () => {
    // Only inspect Express registration; no injected auth operation is invoked.
    const router = createImagingRouter({} as AuthProvider, { pool: {} } as AccessRepository);
    const registered = (
      router as unknown as {
        stack: { route?: { path: string; methods: Record<string, boolean> } }[];
      }
    ).stack.flatMap((layer) =>
      layer.route
        ? Object.keys(layer.route.methods).map(
            (method) => `${method} /api/v1${layer.route!.path.replace(':id', '{id}')}`,
          )
        : [],
    );
    const documented = imagingContracts.map((route) => `${route.method} ${route.path}`);
    expect(registered.sort()).toEqual([...documented].sort());
    const paths = createOpenApiDocument().paths;
    expect(paths['/api/v1/imaging/patients/{id}/images'].post).toBeDefined();
    expect(paths['/api/v1/imaging/images/{id}/content'].get).toBeDefined();
  });
  it('describes CSRF cookie/header/origin on every cookie-authenticated mutation', () => {
    const document = createOpenApiDocument();
    expect(document.paths['/api/v1/access/csrf']).toBeDefined();
    for (const operations of Object.values(document.paths))
      for (const [method, operation] of Object.entries(operations))
        if (['post', 'put', 'patch', 'delete'].includes(method)) {
          const typed = operation as {
            parameters?: { name: string; required: boolean }[];
            security?: object[];
          };
          expect(typed.parameters).toContainEqual(
            expect.objectContaining({ name: 'x-csrf-token', required: true }),
          );
          expect(typed.parameters).toContainEqual(
            expect.objectContaining({ name: 'Origin', required: true }),
          );
          expect(JSON.stringify(typed.security)).toContain('csrfCookie');
        }
  });
});
