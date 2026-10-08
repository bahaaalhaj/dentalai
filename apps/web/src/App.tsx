import { useEffect, useState, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import type { AuthIdentity } from '@dentalai/contracts';
import { ErrorBoundary, LoadingScreen } from '@dentalai/ui';
import { apiClient, ApiClientError } from './lib/api-client';
import { AccountDashboard, RecoveryPage, InvitationPage } from './AccountPage';

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

export default function App() {
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
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
        if (active) setIdentity(value);
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
        Account service unavailable. <button onClick={() => window.location.reload()}>Retry</button>
      </main>
    );
  return (
    <ErrorBoundary>
      <Router>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
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
                  <AccountDashboard
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
      </Router>
    </ErrorBoundary>
  );
}
