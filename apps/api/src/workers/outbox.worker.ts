import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Pool } from 'pg';

interface OutboxJob {
  id: string;
  clinic_id: string;
  topic: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

export type OutboxHandler = (job: {
  id: string;
  clinicId: string;
  topic: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  attempt: number;
}) => Promise<void>;

export interface OutboxWorkerOptions {
  pollIntervalMs: number;
  workerId?: string;
  leaseMs?: number;
  maxAttempts?: number;
}

export class OutboxWorker {
  private timer: NodeJS.Timeout | undefined;
  private stopping = false;
  private activeRun: Promise<void> | undefined;
  private readonly workerId: string;

  constructor(
    private readonly pool: Pool,
    private readonly logger: Logger,
    private readonly handlers: ReadonlyMap<string, OutboxHandler>,
    private readonly options: OutboxWorkerOptions,
  ) {
    this.workerId = options.workerId ?? `api-${randomUUID()}`;
  }

  start(): void {
    if (this.timer || this.activeRun) return;
    this.stopping = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.activeRun;
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.activeRun = this.runOnce()
        .catch(() => {
          // Driver/handler errors can embed credentials, tokens or clinical payloads.
          this.logger.error('Outbox polling failed');
        })
        .finally(() => {
          this.activeRun = undefined;
          this.schedule(this.options.pollIntervalMs);
        });
    }, delay);
    this.timer.unref();
  }

  async runOnce(): Promise<void> {
    const result = await this.pool.query<OutboxJob>(
      `UPDATE outbox_jobs
       SET status = 'processing',
           attempts = attempts + 1,
           locked_at = now(),
           locked_by = $1
       WHERE id = (
         SELECT id
         FROM outbox_jobs
         WHERE attempts<$3 AND ((status IN ('pending', 'failed') AND available_at <= now())
            OR (status = 'processing' AND locked_at <= now() - make_interval(secs => $2)))
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id, clinic_id, topic, aggregate_type, aggregate_id, payload, attempts`,
      [this.workerId, (this.options.leaseMs ?? 300_000) / 1_000, this.options.maxAttempts ?? 8],
    );

    const row = result.rows[0];
    if (!row) return;

    const handler = this.handlers.get(row.topic);
    try {
      if (!handler) {
        throw new Error(`No outbox handler is registered for topic ${row.topic}.`);
      }
      await handler({
        id: row.id,
        clinicId: row.clinic_id,
        topic: row.topic,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        payload: row.payload,
        attempt: row.attempts,
      });
      await this.pool.query(
        `UPDATE outbox_jobs
         SET status = 'completed', completed_at = now(), locked_at = NULL, locked_by = NULL,
             last_error = NULL
         WHERE id = $1 AND locked_by = $2 AND attempts = $3`,
        [row.id, this.workerId, row.attempts],
      );
    } catch {
      await this.pool.query(
        `UPDATE outbox_jobs
         SET status = 'failed', available_at = now() + make_interval(secs => $3),
             locked_at = NULL, locked_by = NULL, last_error = $4
         WHERE id = $1 AND locked_by = $2 AND attempts = $5`,
        [
          row.id,
          this.workerId,
          this.options.pollIntervalMs / 1_000,
          'HANDLER_FAILED',
          row.attempts,
        ],
      );
      this.logger.warn({ outboxJobId: row.id, attempt: row.attempts }, 'Outbox handler failed');
    }
  }
}
