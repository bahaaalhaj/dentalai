import type { Pool } from 'pg';

export async function assertRestrictedDatabaseIdentity(pool: Pool): Promise<void> {
  const result = await pool.query<{
    unsafe: boolean;
  }>(`SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=r.oid)
    OR has_schema_privilege(current_user,'public','CREATE')
    OR has_table_privilege(current_user,'audit_events','UPDATE,DELETE,TRUNCATE') AS unsafe
    FROM pg_roles r WHERE r.rolname=current_user`);
  if (result.rows.length !== 1 || result.rows[0]?.unsafe)
    throw new Error('Deployment requires a restricted, non-owner application database identity.');
}
