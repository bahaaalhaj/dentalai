import type { ReadinessResponse } from '@dentalai/contracts';
import type { ApplicationLifecycle } from '../../infrastructure/lifecycle.js';
import type { SystemRepositoryPort } from './system.repository.js';

async function boundedProbe(probe: () => Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Probe timed out')), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class SystemService {
  constructor(
    private readonly repository: SystemRepositoryPort,
    private readonly lifecycle: ApplicationLifecycle,
    private readonly dependencies: Partial<
      Record<'web' | 'storage' | 'worker' | 'ai', (() => Promise<void>) | 'disabled'>
    > = {},
  ) {}

  async readiness(now = new Date()): Promise<ReadinessResponse> {
    let database: 'ok' | 'error' = 'ok';
    try {
      await boundedProbe(() => this.repository.ping());
    } catch {
      database = 'error';
    }

    const acceptingTraffic = this.lifecycle.isAcceptingTraffic();
    const checks: Record<string, 'ok' | 'error' | 'disabled'> = {};
    await Promise.all(
      Object.entries(this.dependencies).map(async ([name, probe]) => {
        if (probe === 'disabled') {
          checks[name] = 'disabled';
          return;
        }
        try {
          await boundedProbe(probe!);
          checks[name] = 'ok';
        } catch {
          checks[name] = 'error';
        }
      }),
    );
    return {
      service: 'api',
      status:
        database === 'ok' && acceptingTraffic && !Object.values(checks).includes('error')
          ? 'ready'
          : 'not_ready',
      version: 'v1',
      timestamp: now.toISOString(),
      checks: {
        database,
        lifecycle: acceptingTraffic ? 'accepting_traffic' : 'draining',
        ...(Object.keys(checks).length ? { dependencies: checks } : {}),
      },
    };
  }
}
