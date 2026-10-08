import { Link } from 'react-router-dom';
import type { Profile } from '../lib/supabase';

// Legacy profile IDs are not authoritative PostgreSQL patient IDs. Do not forward them.
export function BillingSection(_props: {
  patients: Profile[];
  selectedPatientId?: string | undefined;
}) {
  return (
    <section className="bg-white border rounded-2xl p-6 space-y-3">
      <h2 className="text-xl font-bold">Clinic billing ledger</h2>
      <p>
        Manage invoices, payments, pricing and receipts in the authorized billing workspace.
        Historical costs are never calculated from current tooth status.
      </p>
      <Link className="text-indigo-600" to="/billing">
        Open billing ledger
      </Link>
    </section>
  );
}
