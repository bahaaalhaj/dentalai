import type { ReadinessResponse } from '@dentalai/contracts';
import type { ApplicationLifecycle } from '../../infrastructure/lifecycle.js';
import type { SystemRepositoryPort } from './system.repository.js';

export class SystemService {
  constructor(
    private readonly repository: SystemRepositoryPort,
    private readonly lifecycle: ApplicationLifecycle,
  ) {}

  async readiness(now = new Date()): Promise<ReadinessResponse> {
    let database: 'ok' | 'error' = 'ok';
    try {
      await this.repository.ping();
    } catch {
      database = 'error';
    }

    const acceptingTraffic = this.lifecycle.isAcceptingTraffic();
    return {
      service: 'api',
      status: database === 'ok' && acceptingTraffic ? 'ready' : 'not_ready',
      version: 'v1',
      timestamp: now.toISOString(),
      checks: {
        database,
        lifecycle: acceptingTraffic ? 'accepting_traffic' : 'draining',
      },
    };
  }
}
