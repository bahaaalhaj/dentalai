import { createHmac } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { schema, type DentalDatabase } from '@dentalai/database';
import { AuthIdentitySchema, type AuthIdentity } from '@dentalai/contracts';
import { DomainError } from '../../errors/domain-errors.js';
import { AccessContext } from './access-shared.js';
// Cohesive repository capability; inherited transaction/authorization guards are unchanged.
export class AccessCore {
  constructor(
    readonly pool: Pool,
    protected readonly database: DentalDatabase,
  ) {}
  protected async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw new DomainError('INVITATION_CONFLICT', 'A pending invitation already exists.', 409);
      throw error;
    } finally {
      client.release();
    }
  }
  protected async administrativeAccess(client: PoolClient, context: AccessContext): Promise<void> {
    const membership = context.membership;
    if (!membership) throw new DomainError('ACCESS_DENIED', 'Select a clinic first.', 403);
    await client.query('SELECT saas_lock($1)', [membership.clinicId]);
    const result = await client.query(
      `SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
       JOIN clinics c ON c.id=m.clinic_id AND c.active
       JOIN auth_sessions s ON s.id=$3 AND s.user_id=u.id AND s.expires_at>now()
       JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id
       JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
       WHERE m.id=$1 AND m.clinic_id=$2 AND m.user_id=$4 AND m.status='active'
       AND r.key IN ('clinic_owner','clinic_admin') FOR SHARE OF m,u,c,s,mr,r`,
      [membership.id, membership.clinicId, context.sessionId, context.userId],
    );
    if (!result.rowCount) throw new DomainError('ACCESS_DENIED', 'Clinic access denied.', 403);
  }
  protected async transactionalSecurity(
    client: PoolClient,
    context: AccessContext,
    clinicId: string,
    action: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    await client.query(
      'INSERT INTO security_events(clinic_id,user_id,action,success,request_id) VALUES($1,$2,$3,true,$4)',
      [clinicId, context.userId, action, context.requestId],
    );
    await client.query(
      `INSERT INTO audit_events(clinic_id,actor_user_id,action,entity_type,entity_id,request_id,data)
       VALUES($1,$2,$3,$4,$5,$6,'{"success":true}'::jsonb)`,
      [clinicId, context.userId, action, entityType, entityId, context.requestId],
    );
  }
  async security(
    action: string,
    success: boolean,
    userId?: string,
    requestId?: string,
    clinicId?: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.insert(schema.securityEvents).values({
        action,
        success,
        ...(userId ? { userId } : {}),
        ...(requestId ? { requestId } : {}),
        ...(clinicId ? { clinicId } : {}),
      });
      if (clinicId) {
        await transaction.insert(schema.auditEvents).values({
          clinicId,
          action,
          entityType: 'security',
          ...(userId ? { actorUserId: userId } : {}),
          ...(requestId ? { requestId } : {}),
          data: { success },
        });
      }
    });
  }
  async identity(userId: string, sessionId: string): Promise<AuthIdentity> {
    const user = await this.pool.query<{
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
    }>(
      `SELECT id,display_name AS name,email,email_verified AS "emailVerified" FROM users WHERE id=$1 AND disabled_at IS NULL`,
      [userId],
    );
    if (!user.rows[0])
      throw new DomainError('SESSION_EXPIRED', 'Your session has expired. Sign in again.', 401);
    const memberships = await this.pool.query<AuthIdentity['memberships'][number]>(
      `SELECT m.id,m.clinic_id AS "clinicId",c.display_name AS "clinicName",
        json_agg(r.key ORDER BY r.key) AS roles,p.locale,p.brand_color AS "brandColor",p.brand_mark AS "brandMark"
       FROM memberships m JOIN clinics c ON c.id=m.clinic_id AND c.active
       JOIN clinic_profiles p ON p.clinic_id=c.id
       JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id
       JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
       WHERE m.user_id=$1 AND m.status='active'
       GROUP BY m.id,c.display_name,p.locale,p.brand_color,p.brand_mark ORDER BY m.joined_at,m.id`,
      [userId],
    );
    const session = await this.pool.query<{ active_membership_id: string | null }>(
      'SELECT active_membership_id FROM auth_sessions WHERE id=$1 AND user_id=$2 AND expires_at>now()',
      [sessionId, userId],
    );
    if (!session.rows[0])
      throw new DomainError('SESSION_EXPIRED', 'Your session has expired. Sign in again.', 401);
    const selected = session.rows[0].active_membership_id;
    const activeMembership = selected
      ? (memberships.rows.find((row) => row.id === selected) ?? null)
      : memberships.rows.length === 1
        ? (memberships.rows[0] ?? null)
        : null;
    return AuthIdentitySchema.parse({
      user: user.rows[0],
      memberships: memberships.rows,
      activeMembership,
      accountRole: 'patient',
    });
  }
  async select(context: AccessContext, membershipId: string): Promise<void> {
    await this.transaction(async (client) => {
      const result = await client.query(
        `UPDATE auth_sessions s SET active_membership_id=m.id,clinic_id=m.clinic_id
       FROM memberships m JOIN clinics c ON c.id=m.clinic_id AND c.active
       JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
       WHERE s.id=$1 AND s.user_id=$2 AND s.expires_at>now() AND m.id=$3 AND m.user_id=s.user_id AND m.status='active'
       RETURNING m.clinic_id`,
        [context.sessionId, context.userId, membershipId],
      );
      if (result.rowCount !== 1)
        throw new DomainError('ACCESS_DENIED', 'Clinic access denied.', 403);
      await this.transactionalSecurity(
        client,
        context,
        String(result.rows[0]?.clinic_id),
        'auth.clinic_selected',
        'membership',
        membershipId,
      );
    });
  }
  async sessions(context: AccessContext) {
    const result = await this.pool.query<{ id: string; created_at: Date; expires_at: Date }>(
      'SELECT id,created_at,expires_at FROM auth_sessions WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC',
      [context.userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      current: row.id === context.sessionId,
    }));
  }
  async revoke(context: AccessContext, sessionId: string): Promise<void> {
    await this.transaction(async (client) => {
      const result = await client.query('DELETE FROM auth_sessions WHERE id=$1 AND user_id=$2', [
        sessionId,
        context.userId,
      ]);
      if (result.rowCount !== 1) throw new DomainError('NOT_FOUND', 'Session not found.', 404);
      if (context.membership)
        await this.transactionalSecurity(
          client,
          context,
          context.membership.clinicId,
          'auth.session_revoked',
          'session',
          sessionId,
        );
      else
        await client.query(
          "INSERT INTO security_events(user_id,action,success,request_id) VALUES($1,'auth.session_revoked',true,$2)",
          [context.userId, context.requestId],
        );
    });
  }
  async patient(context: AccessContext, id: string) {
    const membership = context.membership;
    if (!membership) throw new DomainError('ACCESS_DENIED', 'Select a clinic first.', 403);
    const result = await this.pool.query<{
      id: string;
      clinicId: string;
      givenName: string;
      familyName: string;
      medicalRecordNumber: string;
    }>(
      `SELECT id,clinic_id AS "clinicId",given_name AS "givenName",family_name AS "familyName",medical_record_number AS "medicalRecordNumber"
       FROM patients WHERE id=$1 AND clinic_id=$2 AND archived_at IS NULL AND ($3::boolean OR portal_user_id=$4)`,
      [
        id,
        membership.clinicId,
        membership.roles.some((role) => role !== 'patient'),
        context.userId,
      ],
    );
    if (!result.rows[0]) throw new DomainError('NOT_FOUND', 'Patient identity not found.', 404);
    return result.rows[0];
  }
  loginKey(email: string, secret: string): string {
    return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex');
  }
  async loginBlocked(key: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM login_attempts WHERE key=$1 AND blocked_until>now()',
      [key],
    );
    return !!result.rowCount;
  }
  async loginResult(key: string, success: boolean): Promise<void> {
    if (success) {
      await this.pool.query('DELETE FROM login_attempts WHERE key=$1', [key]);
      return;
    }
    await this.pool.query(
      `INSERT INTO login_attempts(key,failures) VALUES($1,1) ON CONFLICT(key) DO UPDATE
       SET failures=CASE WHEN login_attempts.window_started_at<now()-interval '15 minutes' THEN 1 ELSE login_attempts.failures+1 END,
           window_started_at=CASE WHEN login_attempts.window_started_at<now()-interval '15 minutes' THEN now() ELSE login_attempts.window_started_at END,
           blocked_until=CASE WHEN login_attempts.window_started_at>=now()-interval '15 minutes' AND login_attempts.failures+1>=5 THEN now()+interval '15 minutes' ELSE NULL END`,
      [key],
    );
  }
}
