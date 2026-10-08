import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';
import type {
  AuthIdentity,
  InvitationRequestSchema,
  SessionListSchema,
  InvitationSchema,
} from '@dentalai/contracts';
import type { z } from 'zod';
import { apiClient } from './lib/api-client';
import { getErrorMessage } from './lib/errors';

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link to="/" className="flex gap-2 text-indigo-600 text-2xl font-bold">
          <Shield />
          DentalAi
        </Link>
        <section className="bg-white p-8 rounded-3xl border border-slate-100 shadow-xl space-y-5">
          {children}
        </section>
      </div>
    </main>
  );
}
const inputStyle = 'w-full p-3 bg-slate-50 border border-slate-200 rounded-xl';
const buttonStyle = 'px-5 py-3 rounded-xl bg-indigo-600 text-white disabled:opacity-50';

export function AccountDashboard({
  identity,
  refresh,
}: {
  identity: AuthIdentity;
  refresh: () => Promise<void>;
}) {
  const [sessions, setSessions] = useState<z.infer<typeof SessionListSchema>>([]);
  const [invitations, setInvitations] = useState<z.infer<typeof InvitationSchema>[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<z.infer<typeof InvitationRequestSchema>['role']>('dentist');
  const [message, setMessage] = useState('');
  const member = identity.activeMembership;
  const admin =
    member?.roles.some((value) => value === 'clinic_owner' || value === 'clinic_admin') ?? false;
  useEffect(() => {
    apiClient
      .sessions()
      .then(setSessions)
      .catch((error: unknown) => setMessage(getErrorMessage(error)));
  }, []);
  useEffect(() => {
    if (admin)
      apiClient
        .invitations()
        .then(setInvitations)
        .catch((error: unknown) => setMessage(getErrorMessage(error)));
  }, [admin, member?.id]);
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setMessage('Saved.');
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };
  return (
    <Frame>
      <div className="flex justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {identity.user.name}</h1>
        <button
          onClick={() =>
            void run(async () => {
              await apiClient.logout();
              window.location.assign('/login');
            })
          }
        >
          Sign out
        </button>
      </div>
      <p>
        {member
          ? `${member.clinicName} · ${member.roles.join(', ')}`
          : 'Patient account · no clinic access assigned'}
      </p>
      {identity.memberships.length > 1 && (
        <select
          aria-label="Active clinic"
          className={inputStyle}
          value={member?.id ?? ''}
          onChange={(event) =>
            void run(async () => {
              await apiClient.selectMembership(event.target.value);
              await refresh();
            })
          }
        >
          <option value="" disabled>
            Select clinic
          </option>
          {identity.memberships.map((item) => (
            <option key={item.id} value={item.id}>
              {item.clinicName}
            </option>
          ))}
        </select>
      )}
      <p className="p-4 bg-amber-50 rounded-xl text-slate-700">
        Clinical records use clinician-authored versions and explicit approval. Experimental X-ray
        and anesthetic tools remain frozen. Billing uses server-owned invoices and ledger events;
        other unmigrated screens remain unavailable.
      </p>
      {member && (
        <Link to="/appointments" className={buttonStyle}>
          Appointments and calendar
        </Link>
      )}
      {member?.roles.some((r) =>
        ['clinic_owner', 'clinic_admin', 'receptionist', 'dentist'].includes(r),
      ) && (
        <Link to="/billing" className={buttonStyle}>
          Clinic billing
        </Link>
      )}
      {member?.roles.includes('patient') && (
        <Link to="/billing/portal" className={buttonStyle}>
          Your invoices and receipts
        </Link>
      )}
      {member?.roles.includes('dentist') && (
        <Link to="/clinical/patients" className={buttonStyle}>
          Clinical patients
        </Link>
      )}
      {member?.roles.includes('dentist') && (
        <Link to="/imaging" className={buttonStyle}>
          Private X-ray studies (experimental)
        </Link>
      )}
      {member?.roles.includes('patient') && (
        <Link to="/clinical/history" className={buttonStyle}>
          Approved clinical history
        </Link>
      )}
      {message && <p role="status">{message}</p>}
      <h2 className="font-bold">Active sessions</h2>
      {sessions.map((session) => (
        <div className="flex justify-between" key={session.id}>
          <span>
            {session.current ? 'This session' : 'Other session'} · expires{' '}
            {new Date(session.expiresAt).toLocaleString()}
          </span>
          <button
            onClick={() =>
              void run(async () => {
                await apiClient.revokeSession(session.id);
                if (session.current) window.location.assign('/login?expired=1');
                else setSessions(await apiClient.sessions());
              })
            }
          >
            Revoke
          </button>
        </div>
      ))}
      {admin && (
        <>
          <h2 className="font-bold">Invite clinic staff</h2>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await apiClient.invite({ email, role });
                setEmail('');
                setInvitations(await apiClient.invitations());
              });
            }}
          >
            <input
              aria-label="Invite email"
              type="email"
              required
              className={inputStyle}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <select
              aria-label="Invited role"
              className={inputStyle}
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              <option value="dentist">Dentist</option>
              <option value="receptionist">Receptionist</option>
              <option value="clinic_admin">Clinic admin</option>
            </select>
            <button className={buttonStyle}>Send invitation</button>
          </form>
          {invitations.map((invitation) => (
            <div key={invitation.id}>
              {invitation.email} · {invitation.role} · {invitation.status}{' '}
              {invitation.status === 'pending' && (
                <button
                  onClick={() =>
                    void run(async () => {
                      await apiClient.revokeInvitation(invitation.id);
                      setInvitations(await apiClient.invitations());
                    })
                  }
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </Frame>
  );
}

export function RecoveryPage({ reset = false }: { reset?: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  useEffect(() => {
    if (reset) window.history.replaceState(null, '', window.location.pathname);
  }, [reset]);
  async function submit(event: FormEvent, verification = false) {
    event.preventDefault();
    setBusy(true);
    try {
      if (reset) {
        await apiClient.resetPassword(token, password);
        setMessage('Password reset. All previous sessions are revoked. Sign in again.');
      } else {
        await (verification ? apiClient.resendVerification(email) : apiClient.requestReset(email));
        setMessage('If the account is eligible, an email will be sent.');
      }
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame>
      <h1 className="text-2xl font-bold">{reset ? 'Reset password' : 'Account recovery'}</h1>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        {reset ? (
          <input
            aria-label="New password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            className={inputStyle}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        ) : (
          <input
            aria-label="Email"
            type="email"
            required
            className={inputStyle}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
        <button disabled={busy || (reset && !token)} className={buttonStyle}>
          {reset ? 'Set password' : 'Send reset email'}
        </button>
        {!reset && (
          <button disabled={busy} type="button" onClick={(event) => void submit(event, true)}>
            Resend verification
          </button>
        )}
      </form>
      <p role="status">{message}</p>
      <Link to="/login">Sign in</Link>
    </Frame>
  );
}

export function InvitationPage({ identity }: { identity: AuthIdentity | null }) {
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Frame>
      <h1 className="text-2xl font-bold">Clinic invitation</h1>
      {!identity ? (
        <p>
          Sign in or register and verify the invited email, then reopen the link from your email.{' '}
          <Link to="/login">Sign in</Link> · <Link to="/register">Register</Link>
        </p>
      ) : (
        <>
          <p>
            Accepting as {identity.user.email}. Your access is determined by the clinic invitation,
            not account registration.
          </p>
          <button
            className={buttonStyle}
            disabled={busy || !token}
            onClick={() => {
              setBusy(true);
              void apiClient
                .acceptInvitation(token)
                .then(() => {
                  window.history.replaceState(null, '', '/invitation');
                  window.location.assign('/dashboard');
                })
                .catch((error: unknown) => setMessage(getErrorMessage(error)))
                .finally(() => setBusy(false));
            }}
          >
            Accept invitation
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </Frame>
  );
}
