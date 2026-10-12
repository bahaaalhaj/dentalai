import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { AuthMail, MailSender } from '../auth/mail.js';
import type { OutboxHandler } from '../../workers/outbox.worker.js';

const MessageSchema = z
  .object({ to: z.email(), subject: z.string().min(1).max(200), text: z.string().min(1).max(5000) })
  .strict();
export interface NotificationProvider {
  readonly name: string;
  send(message: AuthMail, idempotencyKey: string): Promise<{ reference: string | null }>;
}
export function emailNotificationProvider(
  sender: MailSender,
  name = 'configured-email',
): NotificationProvider {
  return {
    name,
    async send(message) {
      await sender(message);
      return { reference: null };
    },
  };
}
export function encryptNotification(message: AuthMail, secret: string) {
  const iv = randomBytes(12),
    key = createHash('sha256').update(`notification:v1:${secret}`).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(MessageSchema.parse(message)), 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), data].map((value) => value.toString('base64url')).join('.');
}
export function decryptNotification(value: string, secret: string) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid notification envelope');
  const key = createHash('sha256').update(`notification:v1:${secret}`).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0]!, 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[1]!, 'base64url'));
  return MessageSchema.parse(
    JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(parts[2]!, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    ),
  );
}
/** Called inside the business transaction. Outbox contains only an opaque delivery ID, never a token. */
export async function enqueueNotification(
  db: PoolClient,
  clinic: string,
  message: AuthMail,
  secret: string,
  options: { category: 'invitation' | 'operational'; membershipId?: string; invitationId?: string },
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO notification_deliveries(id,clinic_id,recipient,membership_id,category,encrypted_message,invitation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      clinic,
      message.to,
      options.membershipId ?? null,
      options.category,
      encryptNotification(message, secret),
      options.invitationId ?? null,
    ],
  );
  await db.query(
    `INSERT INTO outbox_jobs(clinic_id,topic,aggregate_type,aggregate_id,idempotency_key,payload)
    VALUES($1,'notification.email','notification',$2::uuid,$2::uuid::text,jsonb_build_object('deliveryId',$2::uuid::text))`,
    [clinic, id],
  );
  return id;
}

export function notificationHandlers(
  pool: Pool,
  provider: NotificationProvider,
  secret: string,
): ReadonlyMap<string, OutboxHandler> {
  const handler: OutboxHandler = async (job) => {
    const id = z.object({ deliveryId: z.uuid() }).strict().parse(job.payload).deliveryId;
    const db = await pool.connect();
    let committed = false;
    try {
      await db.query('BEGIN');
      const result = await db.query<{
        recipient: string;
        category: 'invitation' | 'operational';
        state: string;
        encrypted_message: string;
        membership_id: string | null;
        invitation_id: string | null;
      }>('SELECT * FROM notification_deliveries WHERE id=$1 AND clinic_id=$2 FOR UPDATE', [
        id,
        job.clinicId,
      ]);
      const row = result.rows[0];
      if (!row) throw new Error('Notification unavailable');
      if (row.state === 'accepted' || row.state === 'skipped') {
        await db.query('COMMIT');
        return;
      }
      const active = await db.query('SELECT 1 FROM clinics WHERE id=$1 AND active', [job.clinicId]);
      const invitation = row.invitation_id
        ? await db.query(
            `SELECT 1 FROM invitations i JOIN memberships m ON m.id=i.invited_by_membership_id AND m.clinic_id=i.clinic_id
        JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
        JOIN membership_roles mr ON mr.membership_id=m.id AND mr.clinic_id=m.clinic_id JOIN roles r ON r.id=mr.role_id AND r.clinic_id=mr.clinic_id
        WHERE i.id=$1 AND i.clinic_id=$2 AND i.status='pending' AND i.expires_at>now() AND m.status='active' AND r.key IN ('clinic_owner','clinic_admin')`,
            [row.invitation_id, job.clinicId],
          )
        : null;
      const recipient = row.membership_id
        ? await db.query(
            "SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL WHERE m.clinic_id=$1 AND m.id=$2 AND m.status='active'",
            [job.clinicId, row.membership_id],
          )
        : null;
      const preference = row.membership_id
        ? await db.query<{ operational_email: boolean }>(
            'SELECT operational_email FROM notification_preferences WHERE clinic_id=$1 AND membership_id=$2',
            [job.clinicId, row.membership_id],
          )
        : null;
      if (
        !active.rowCount ||
        (invitation && !invitation.rowCount) ||
        (recipient && !recipient.rowCount) ||
        (row.category === 'operational' && preference?.rows[0]?.operational_email === false)
      ) {
        await db.query(
          "UPDATE notification_deliveries SET state='skipped',attempts=$3,error_code=NULL WHERE id=$1 AND clinic_id=$2",
          [id, job.clinicId, job.attempt],
        );
      } else {
        try {
          const receipt = await provider.send(
            decryptNotification(row.encrypted_message, secret),
            id,
          );
          await db.query(
            "UPDATE notification_deliveries SET state='accepted',accepted_at=now(),attempts=$3,provider=$4,provider_reference=$5,error_code=NULL WHERE id=$1 AND clinic_id=$2",
            [id, job.clinicId, job.attempt, provider.name, receipt.reference],
          );
        } catch {
          await db.query(
            "UPDATE notification_deliveries SET state='failed',attempts=$3,provider=$4,error_code='PROVIDER_UNAVAILABLE' WHERE id=$1 AND clinic_id=$2",
            [id, job.clinicId, job.attempt, provider.name],
          );
          await db.query(
            `INSERT INTO audit_events(clinic_id,action,entity_type,entity_id,data) VALUES($1,'notification.failed','notification',$2,jsonb_build_object('attempt',$3::integer,'errorCode','PROVIDER_UNAVAILABLE'))`,
            [job.clinicId, id, job.attempt],
          );
          await db.query('COMMIT');
          committed = true;
          throw new Error('Notification provider unavailable');
        }
      }
      await db.query(
        `INSERT INTO audit_events(clinic_id,action,entity_type,entity_id,data) VALUES($1,'notification.processed','notification',$2,jsonb_build_object('attempt',$3::integer))`,
        [job.clinicId, id, job.attempt],
      );
      await db.query('COMMIT');
    } catch (error) {
      if (!committed) await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  };
  return new Map([['notification.email', handler]]);
}
