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
import { t } from './i18n';
import { displayStatus, formatInstant } from './i18n/display';
import { NotificationPreference } from './administration/NotificationPreference';

function Frame({ children, embedded = false }: { children: ReactNode; embedded?: boolean }) {
  const Container = embedded ? 'section' : 'main';
  return (
    <Container className={embedded ? 'ui-card mt-5' : 'min-h-screen bg-slate-50 p-6'}>
      <div className="max-w-3xl mx-auto space-y-6">
        <Link to="/" className="flex gap-2 text-indigo-600 text-2xl font-bold">
          <Shield />
          {t('ui.9ffbc5261ff3b471')}
        </Link>
        <section className="bg-white p-8 rounded-3xl border border-slate-100 shadow-xl space-y-5">
          {children}
        </section>
      </div>
    </Container>
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
      setMessage(t('ui.fca046ccd586c67f'));
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };
  return (
    <Frame embedded>
      <div className="flex justify-between">
        <h2 className="text-2xl font-bold text-slate-900">
          {t('ui.7f95b16f05f5d976')}
          {identity.user.name}
        </h2>
        <button
          onClick={() =>
            void run(async () => {
              await apiClient.logout();
              window.location.assign('/login');
            })
          }
        >
          {t('ui.48f0d3d397d49f13')}
        </button>
      </div>
      <p>
        {member
          ? t('ui.6a5b166856cbece0', { v0: member.clinicName, v1: member.roles.join(', ') })
          : t('ui.45e5254085eb0ad8')}
      </p>
      {admin && (
        <Link to="/administration" className={buttonStyle}>
          {t('admin.title')}
        </Link>
      )}
      {member && <NotificationPreference key={member.id} />}
      {!identity.memberships.some((m) => m.roles.includes('clinic_owner')) && (
        <Link to="/onboarding" className={buttonStyle}>
          {t('admin.onboard')}
        </Link>
      )}
      {identity.memberships.length > 1 && (
        <button className={buttonStyle} onClick={() => void run(refresh)}>
          {t('ui.0e91610117029a62')}
        </button>
      )}
      <p className="p-4 bg-amber-50 rounded-xl text-slate-700">{t('account.limitations')}</p>
      {member && (
        <Link to="/appointments" className={buttonStyle}>
          {t('ui.a1164b91bb0b2fad')}
        </Link>
      )}
      {member?.roles.some((r) =>
        ['clinic_owner', 'clinic_admin', 'receptionist', 'dentist'].includes(r),
      ) && (
        <Link to="/billing" className={buttonStyle}>
          {t('ui.334a67136be1afb3')}
        </Link>
      )}
      {member?.roles.includes('patient') && (
        <Link to="/billing/portal" className={buttonStyle}>
          {t('ui.e0d166dca6b8ae62')}
        </Link>
      )}
      {member?.roles.includes('dentist') && (
        <Link to="/clinical/patients" className={buttonStyle}>
          {t('ui.794807d3934392d8')}
        </Link>
      )}
      {member?.roles.includes('dentist') && (
        <Link to="/imaging" className={buttonStyle}>
          {t('ui.ac45840cdc7d09ee')}
        </Link>
      )}
      {member?.roles.includes('patient') && (
        <Link to="/clinical/history" className={buttonStyle}>
          {t('ui.4db883d983b471bb')}
        </Link>
      )}
      {message && <p role="status">{message}</p>}
      <h2 className="font-bold">{t('ui.61ad990902e7bc32')}</h2>
      {sessions.map((session) => (
        <div className="flex justify-between" key={session.id}>
          <span>
            {session.current ? t('ui.6da6530a0728728e') : t('ui.d862a5b820acbe98')}{' '}
            {t('ui.1de5fe01e955da22')} {formatInstant(session.expiresAt)}
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
            {t('ui.87e6d00bbf53ec5a')}
          </button>
        </div>
      ))}
      {admin && (
        <>
          <h2 className="font-bold">{t('ui.33039a27b719f968')}</h2>
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
              aria-label={t('ui.acb03ba6d22b1075')}
              type="email"
              required
              className={inputStyle}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <select
              aria-label={t('ui.bbde62ad1c2d3b72')}
              className={inputStyle}
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              <option value="dentist">{t('ui.7de3e38e73038666')}</option>
              <option value="receptionist">{t('ui.ab63c0d065704040')}</option>
              <option value="clinic_admin">{t('ui.81a1682944e2e2d9')}</option>
            </select>
            <p>{t('ui.d709ec0406a6abbd')}</p>
            <button className={buttonStyle}>{t('ui.dba4038b651b7bf1')}</button>
          </form>
          {invitations.map((invitation) => (
            <div key={invitation.id}>
              {invitation.email} · {displayStatus(invitation.role)} ·{' '}
              {displayStatus(invitation.status)}{' '}
              {invitation.status === 'pending' && (
                <button
                  onClick={() =>
                    void run(async () => {
                      await apiClient.revokeInvitation(invitation.id);
                      setInvitations(await apiClient.invitations());
                    })
                  }
                >
                  {t('ui.87e6d00bbf53ec5a')}
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
        setMessage(t('ui.0659ae06bd750610'));
      } else {
        await (verification ? apiClient.resendVerification(email) : apiClient.requestReset(email));
        setMessage(t('ui.16824002ed69eaf3'));
      }
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame>
      <h1 className="text-2xl font-bold">
        {reset ? t('ui.e0edfeb3a71a1002') : t('ui.2b291cd5cd2fb9bc')}
      </h1>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        {reset ? (
          <input
            aria-label={t('ui.3dd9df4441fb348f')}
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
            aria-label={t('ui.969ccbd3cf6300ec')}
            type="email"
            required
            className={inputStyle}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
        <button disabled={busy || (reset && !token)} className={buttonStyle}>
          {reset ? t('ui.4e4116871bf1515d') : t('ui.dcdb5ecb61530dd1')}
        </button>
        {!reset && (
          <button disabled={busy} type="button" onClick={(event) => void submit(event, true)}>
            {t('ui.1eedf1ae24597927')}
          </button>
        )}
      </form>
      <p role="status">{message}</p>
      <Link to="/login">{t('ui.bfd402b2f6f38125')}</Link>
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
      <h1 className="text-2xl font-bold">{t('ui.1a939796739d7798')}</h1>
      {!identity ? (
        <p>
          {t('ui.0950d9c775275283')} <Link to="/login">{t('ui.bfd402b2f6f38125')}</Link> ·{' '}
          <Link to="/register">{t('ui.bb7234ec12451361')}</Link>
        </p>
      ) : (
        <>
          <p>
            {t('ui.bfbeb8b09e554bba')}
            {identity.user.email}
            {t('ui.2294212ae80e7f2f')}
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
            {t('ui.7e17aadc3039da77')}
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </Frame>
  );
}
