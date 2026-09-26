import React, { useEffect, useState, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, UserRole } from './lib/supabase';
import { LoadingScreen } from './components/LoadingScreen'

const LandingPage = lazy(() => import('./LandingPage').then(m => ({ default: m.LandingPage })));
const AuthPage = lazy(() => import('./AuthPage').then(m => ({ default: m.AuthPage })));
const PatientDashboard = lazy(() => import('./PatientDashboard').then(m => ({ default: m.PatientDashboard })));
const DoctorDashboard = lazy(() => import('./DoctorDashboard').then(m => ({ default: m.DoctorDashboard })));

import { ErrorBoundary } from './components/ErrorBoundary'

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchRole(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchRole(session.user.id);
      else {
        setRole(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchRole(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
      
      if (error) {
        console.error('Error fetching role:', error);
        setRole('patient');
      } else {
        console.log('User role fetched:', data?.role);
        setRole(data?.role as UserRole || 'patient');
      }
    } catch (err) {
      console.error('Unexpected error fetching role:', err);
      setRole('patient');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <LoadingScreen />;

  return (
    <ErrorBoundary>
      <Router>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={session ? <Navigate to="/dashboard" /> : <AuthPage mode="login" />} />
            <Route path="/register" element={session ? <Navigate to="/dashboard" /> : <AuthPage mode="register" />} />
            
            <Route 
              path="/dashboard" 
              element={
                session ? (
                  role === 'doctor' ? <DoctorDashboard /> : <PatientDashboard />
                ) : (
                  <Navigate to="/" />
                )
              } 
            />
          </Routes>
        </Suspense>
      </Router>
    </ErrorBoundary>
  );
}
