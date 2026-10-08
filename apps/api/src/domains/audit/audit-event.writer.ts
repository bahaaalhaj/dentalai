import { schema, type DentalDatabase, type DentalTransaction } from '@dentalai/database';

export interface AuditEventInput {
  clinicId: string;
  actorUserId?: string;
  actorMembershipId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  data?: Record<string, unknown>;
}

export interface WrittenAuditEvent {
  id: string;
  clinicId: string;
  occurredAt: Date;
}

type AuditExecutor = DentalDatabase | DentalTransaction;

export class AuditEventWriter {
  async write(executor: AuditExecutor, event: AuditEventInput): Promise<WrittenAuditEvent> {
    const [created] = await executor
      .insert(schema.auditEvents)
      .values({
        clinicId: event.clinicId,
        action: event.action,
        entityType: event.entityType,
        data: event.data ?? {},
        ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
        ...(event.actorMembershipId ? { actorMembershipId: event.actorMembershipId } : {}),
        ...(event.entityId ? { entityId: event.entityId } : {}),
        ...(event.requestId ? { requestId: event.requestId } : {}),
        ...(event.ipAddress ? { ipAddress: event.ipAddress } : {}),
        ...(event.userAgent ? { userAgent: event.userAgent } : {}),
      })
      .returning({
        id: schema.auditEvents.id,
        clinicId: schema.auditEvents.clinicId,
        occurredAt: schema.auditEvents.occurredAt,
      });

    if (!created) {
      throw new Error('Audit event insert returned no row.');
    }
    return created;
  }
}
