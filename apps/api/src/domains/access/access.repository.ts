import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { schema, type DentalDatabase } from '@dentalai/database';
import { AuthIdentitySchema, type AuthIdentity, type ClinicRole } from '@dentalai/contracts';
import { DomainError } from '../../errors/domain-errors.js';
import type { MailSender } from '../auth/mail.js';

export interface AccessContext {
  userId: string;
  sessionId: string;
  membership: AuthIdentity['activeMembership'];
  requestId: string;
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export class AccessRepository {
  constructor(
    readonly pool: Pool,
    private readonly database: DentalDatabase,
  ) {}

  async security(
    action: string,
    success: boolean,
    userId?: string,
    requestId?: string,
    clinicId?: string,
  ): Promise<void> {
    await this.database.insert(schema.securityEvents).values({
      action,
      success,
      ...(userId ? { userId } : {}),
      ...(requestId ? { requestId } : {}),
      ...(clinicId ? { clinicId } : {}),
    });
    if (clinicId) {
      await this.database.insert(schema.auditEvents).values({
        clinicId,
        action,
        entityType: 'security',
        ...(userId ? { actorUserId: userId } : {}),
        ...(requestId ? { requestId } : {}),
        data: { success },
      });
    }
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
        json_agg(r.key ORDER BY r.key) AS roles
       FROM memberships m JOIN clinics c ON c.id=m.clinic_id AND c.active
       JOIN membership_roles mr ON mr.clinic_id=m.clinic_id AND mr.membership_id=m.id
       JOIN roles r ON r.clinic_id=mr.clinic_id AND r.id=mr.role_id
       WHERE m.user_id=$1 AND m.status='active'
       GROUP BY m.id,c.display_name ORDER BY m.joined_at,m.id`,
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
    const result = await this.pool.query(
      `UPDATE auth_sessions s SET active_membership_id=m.id,clinic_id=m.clinic_id
       FROM memberships m JOIN clinics c ON c.id=m.clinic_id AND c.active
       WHERE s.id=$1 AND s.user_id=$2 AND m.id=$3 AND m.user_id=s.user_id AND m.status='active'`,
      [context.sessionId, context.userId, membershipId],
    );
    if (result.rowCount !== 1) throw new DomainError('ACCESS_DENIED', 'Clinic access denied.', 403);
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
    const result = await this.pool.query('DELETE FROM auth_sessions WHERE id=$1 AND user_id=$2', [
      sessionId,
      context.userId,
    ]);
    if (result.rowCount !== 1) throw new DomainError('NOT_FOUND', 'Session not found.', 404);
  }

  async invitationList(clinicId: string) {
    const result = await this.pool.query<{
      id: string;
      email: string;
      role: ClinicRole;
      status: string;
      expires_at: Date;
    }>(
      `SELECT i.id,i.email,r.key AS role,i.status,i.expires_at FROM invitations i JOIN roles r ON r.id=i.role_id AND r.clinic_id=i.clinic_id WHERE i.clinic_id=$1 ORDER BY i.created_at DESC`,
      [clinicId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      expiresAt: row.expires_at.toISOString(),
    }));
  }

  async invite(
    context: AccessContext,
    email: string,
    role: ClinicRole,
    sendMail: MailSender,
    origin: string,
  ) {
    const membership = context.membership;
    if (!membership) throw new DomainError('ACCESS_DENIED', 'Select a clinic first.', 403);
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 3_600_000);
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO invitations(clinic_id,email,role_id,token_hash,invited_by_membership_id,expires_at)
       SELECT $1,$2,r.id,$3,$4,$5 FROM roles r WHERE r.clinic_id=$1 AND r.key=$6 RETURNING id`,
      [membership.clinicId, email.toLowerCase(), digest(token), membership.id, expiresAt, role],
    );
    const row = result.rows[0];
    if (!row)
      throw new DomainError('ROLE_NOT_CONFIGURED', 'The clinic role is not configured.', 409);
    try {
      await sendMail({
        to: email,
        subject: 'DentalAI clinic invitation',
        text: `Sign in or create a patient account with this email, verify it, then accept your clinic invitation: ${origin}/invitation#token=${token}`,
      });
    } catch {
      await this.pool.query("UPDATE invitations SET status='revoked' WHERE id=$1", [row.id]);
      throw new DomainError(
        'EMAIL_UNAVAILABLE',
        'The invitation could not be delivered. Try again later.',
        503,
      );
    }
    return {
      id: row.id,
      email: email.toLowerCase(),
      role,
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
    };
  }

  async revokeInvitation(clinicId: string, id: string): Promise<void> {
    const result = await this.pool.query(
      "UPDATE invitations SET status='revoked' WHERE id=$1 AND clinic_id=$2 AND status='pending'",
      [id, clinicId],
    );
    if (result.rowCount !== 1) throw new DomainError('NOT_FOUND', 'Invitation not found.', 404);
  }

  async accept(context: AccessContext, token: string): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const invitation = await client.query<{
        id: string;
        clinic_id: string;
        role_id: string;
        role: ClinicRole;
      }>(
        `SELECT i.id,i.clinic_id,i.role_id,r.key AS role FROM invitations i
         JOIN roles r ON r.id=i.role_id AND r.clinic_id=i.clinic_id
         JOIN users u ON lower(u.email)=lower(i.email) AND u.id=$2 AND u.email_verified AND u.disabled_at IS NULL
         JOIN clinics c ON c.id=i.clinic_id AND c.active
         WHERE i.token_hash=$1 AND i.status='pending' AND i.expires_at>now()
           AND r.key IN ('clinic_admin','dentist','receptionist') FOR UPDATE OF i`,
        [digest(token), context.userId],
      );
      const row = invitation.rows[0];
      if (!row)
        throw new DomainError('INVALID_INVITATION', 'This invitation is invalid or expired.', 403);
      // Prevent accepting an invitation after its issuer loses administrative access.
      const issuer = await client.query(
        `SELECT 1 FROM invitations i JOIN memberships m ON m.id=i.invited_by_membership_id AND m.clinic_id=i.clinic_id
         JOIN membership_roles mr ON mr.membership_id=m.id AND mr.clinic_id=m.clinic_id
         JOIN roles r ON r.id=mr.role_id AND r.clinic_id=mr.clinic_id
         WHERE i.id=$1 AND m.status='active' AND r.key IN ('clinic_owner','clinic_admin')`,
        [row.id],
      );
      if (!issuer.rowCount)
        throw new DomainError(
          'INVALID_INVITATION',
          'The invitation issuer no longer has access.',
          403,
        );
      const member = await client.query<{ id: string }>(
        `INSERT INTO memberships(clinic_id,user_id,status,joined_at) VALUES ($1,$2,'active',now())
         ON CONFLICT(clinic_id,user_id) DO UPDATE SET status='active' RETURNING id`,
        [row.clinic_id, context.userId],
      );
      const memberId = member.rows[0]?.id;
      await client.query(
        'INSERT INTO membership_roles(clinic_id,membership_id,role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [row.clinic_id, memberId, row.role_id],
      );
      const employee = await client.query<{ id: string }>(
        `INSERT INTO staff(clinic_id,membership_id,kind) VALUES ($1,$2,$3)
         ON CONFLICT(clinic_id,membership_id) DO UPDATE SET active=true,kind=CASE WHEN EXCLUDED.kind='provider' THEN EXCLUDED.kind ELSE staff.kind END RETURNING id`,
        [row.clinic_id, memberId, row.role === 'dentist' ? 'provider' : 'staff'],
      );
      if (row.role === 'dentist')
        await client.query(
          `INSERT INTO providers(clinic_id,staff_id,provider_type) VALUES ($1,$2,'dentist') ON CONFLICT(clinic_id,staff_id) DO NOTHING`,
          [row.clinic_id, employee.rows[0]?.id],
        );
      await client.query("UPDATE invitations SET status='accepted',accepted_at=now() WHERE id=$1", [
        row.id,
      ]);
      await client.query(
        'UPDATE auth_sessions SET clinic_id=$1,active_membership_id=$2 WHERE id=$3 AND user_id=$4',
        [row.clinic_id, memberId, context.sessionId, context.userId],
      );
      await client.query(
        `INSERT INTO audit_events(clinic_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,request_id) VALUES ($1,$2,$3,'auth.invitation_accepted','invitation',$4,$5)`,
        [row.clinic_id, context.userId, memberId, row.id, context.requestId],
      );
      await client.query('COMMIT');
      return row.clinic_id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
