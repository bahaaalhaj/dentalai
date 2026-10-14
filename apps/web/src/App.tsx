import { useEffect, useState, Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { AuthIdentity } from '@dentalai/contracts';
import { ErrorBoundary, LoadingScreen } from '@dentalai/ui';
import { apiClient, ApiClientError } from './lib/api-client';
import { RecoveryPage, InvitationPage } from './AccountPage';
import { hasLocalePreference, setLocale, t, useLocale } from './i18n';
import { LanguageControl } from './i18n/LanguageControl';
import { AppShell } from './shell/AppShell';

const DashboardPage = lazy(() =>
  import('./dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const PatientsDirectory = lazy(() =>
  import('./dashboard/PatientsDirectory').then((m) => ({ default: m.PatientsDirectory })),
);

function RouteFrame({
  identity,
  refresh,
  children,
}: {
  identity: AuthIdentity | null;
  refresh: () => Promise<void>;
  children: ReactNode;
}) {
  const location = useLocation(),
    locale = useLocale();
  const publicRoute = [
    '/',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/invitation',
  ].includes(location.pathname);
  if (identity && !publicRoute)
    return (
      <AppShell identity={identity} refresh={refresh}>
        {locale === 'ar' && (
          <p role="note" className="ui-caption mb-4">
            {t('admin.terminology')}
          </p>
        )}
        {children}
      </AppShell>
    );
  return (
    <>
      <LanguageControl />
      {locale === 'ar' && (
        <p role="note" className="bg-amber-50 p-2 text-sm">
          {t('admin.terminology')}
        </p>
      )}
      {children}
    </>
  );
}

const LandingPage = lazy(() => import('./LandingPage').then((m) => ({ default: m.LandingPage })));
const AuthPage = lazy(() => import('./AuthPage').then((m) => ({ default: m.AuthPage })));
const AppointmentsPage = lazy(() =>
  import('./AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })),
);
const ClinicianPatientsPage = lazy(() =>
  import('./clinical/ClinicianPatientsPage').then((m) => ({ default: m.ClinicianPatientsPage })),
);
const PatientClinicalHistory = lazy(() =>
  import('./clinical/PatientClinicalHistory').then((m) => ({ default: m.PatientClinicalHistory })),
);
const BillingPage = lazy(() =>
  import('./billing/BillingPage').then((m) => ({ default: m.BillingPage })),
);
const ImagingPage = lazy(() =>
  import('./imaging/ImagingPage').then((m) => ({ default: m.ImagingPage })),
);
const AdministrationPage = lazy(() =>
  import('./administration/AdministrationPage').then((m) => ({ default: m.AdministrationPage })),
);
const OnboardingPage = lazy(() =>
  import('./administration/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
);

export default function App() {
  const locale = useLocale();
  useEffect(() => {
    setLocale(locale, false);
  }, [locale]);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  useEffect(() => {
    if (identity && !hasLocalePreference())
      setLocale(identity.activeMembership?.locale ?? 'en', false);
  }, [identity]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    const expired = () => {
      if (active) setIdentity(null);
    };
    window.addEventListener('dentalai:session-expired', expired);
    apiClient
      .me()
      .then((value) => {
        if (active) {
          setIdentity(value);
        }
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof ApiClientError && error.status === 401))
          setUnavailable(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.removeEventListener('dentalai:session-expired', expired);
    };
  }, []);
  if (loading) return <LoadingScreen />;
  if (unavailable)
    return (
      <main className="p-10 text-slate-700">
        {t('ui.0345a7cc26fc8760')}
        <button onClick={() => window.location.reload()}>{t('ui.942087cc2d41e013')}</button>
      </main>
    );
  return (
    <ErrorBoundary>
      <Router>
        <RouteFrame identity={identity} refresh={async () => setIdentity(await apiClient.me())}>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              <Route
                path="/patients"
                element={
                  identity?.activeMembership?.roles.some((role) => role !== 'patient') ? (
                    <PatientsDirectory key={identity.activeMembership.id} identity={identity} />
                  ) : (
                    <Navigate to={identity ? '/dashboard' : '/login?expired=1'} replace />
                  )
                }
              />
              <Route
                path="/onboarding"
                element={
                  identity ? (
                    <OnboardingPage refresh={async () => setIdentity(await apiClient.me())} />
                  ) : (
                    <Navigate to="/login?expired=1" replace />
                  )
                }
              />
              <Route
                path="/administration"
                element={
                  identity?.activeMembership?.roles.some((role) =>
                    ['clinic_owner', 'clinic_admin'].includes(role),
                  ) ? (
                    <AdministrationPage
                      key={identity.activeMembership.id}
                      identity={identity}
                      refreshIdentity={async () => setIdentity(await apiClient.me())}
                    />
                  ) : (
                    <Navigate to={identity ? '/dashboard' : '/login?expired=1'} replace />
                  )
                }
              />
              <Route
                path="/imaging"
                element={
                  identity?.activeMembership?.roles.includes('dentist') ? (
                    <ImagingPage key={identity.activeMembership.id} />
                  ) : (
                    <Navigate to={identity ? '/dashboard' : '/login?expired=1'} replace />
                  )
                }
              />
              <Route
                path="/billing"
                element={
                  identity?.activeMembership?.roles.some((r) =>
                    ['clinic_owner', 'clinic_admin', 'receptionist', 'dentist'].includes(r),
                  ) ? (
                    <BillingPage key={identity.activeMembership.id} />
                  ) : (
                    <Navigate to={identity ? '/dashboard' : '/login?expired=1'} replace />
                  )
                }
              />
              <Route
                path="/billing/portal"
                element={
                  identity?.activeMembership?.roles.includes('patient') ? (
                    <BillingPage portal key={identity.activeMembership.id} />
                  ) : (
                    <Navigate to={identity ? '/dashboard' : '/login?expired=1'} replace />
                  )
                }
              />
              <Route path="/" element={<LandingPage />} />
              <Route
                path="/login"
                element={identity ? <Navigate to="/dashboard" /> : <AuthPage mode="login" />}
              />
              <Route
                path="/register"
                element={identity ? <Navigate to="/dashboard" /> : <AuthPage mode="register" />}
              />
              <Route path="/forgot-password" element={<RecoveryPage />} />
              <Route path="/reset-password" element={<RecoveryPage reset />} />
              <Route path="/invitation" element={<InvitationPage identity={identity} />} />
              <Route
                path="/clinical/patients"
                element={
                  identity?.activeMembership?.roles.includes('dentist') ? (
                    <ClinicianPatientsPage key={identity.activeMembership.id} />
                  ) : (
                    <Navigate to={identity ? '/dashboard' : '/login?expired=1'} replace />
                  )
                }
              />
              <Route
                path="/clinical/history"
                element={
                  identity?.activeMembership?.roles.includes('patient') ? (
                    <PatientClinicalHistory key={identity.activeMembership.id} />
                  ) : (
                    <Navigate to={identity ? '/dashboard' : '/login?expired=1'} replace />
                  )
                }
              />
              <Route
                path="/appointments"
                element={
                  identity ? (
                    identity.activeMembership ? (
                      <AppointmentsPage key={identity.activeMembership.id} identity={identity} />
                    ) : (
                      <Navigate to="/dashboard" replace />
                    )
                  ) : (
                    <Navigate to="/login?expired=1" replace />
                  )
                }
              />
              <Route
                path="/dashboard"
                element={
                  identity ? (
                    <DashboardPage
                      key={identity.activeMembership?.id ?? identity.user.id}
                      identity={identity}
                      refresh={async () => setIdentity(await apiClient.me())}
                    />
                  ) : (
                    <Navigate to="/login?expired=1" replace />
                  )
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </RouteFrame>
      </Router>
    </ErrorBoundary>
  );
}
