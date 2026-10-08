import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { apiClient } from './lib/api-client';
import type { Profile, ToothStatus, XrayImage } from './lib/supabase';
import { TeethChart } from './components/TeethChart';
import { Calendar, Clock, User, LogOut, FileText, Brain } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from './lib/utils';

export function PatientDashboard() {
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') || 'dashboard';
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('tab', activeTab);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
  }, [activeTab]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [teethStatus, setTeethStatus] = useState<ToothStatus>({});
  const [doctorAdvice, setDoctorAdvice] = useState<string | null>(null);
  const [patientXrays, setPatientXrays] = useState<XrayImage[]>([]);

  const loadData = React.useCallback(async () => {
    const { user } = await apiClient.me();
    if (user) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      const { data: recordData } = await supabase
        .from('medical_records')
        .select('medical_history, teeth_status')
        .eq('patient_id', user.id)
        .single();
      if (recordData) {
        if (recordData.medical_history) {
          setDoctorAdvice(recordData.medical_history);
        }
        if (recordData.teeth_status) {
          setTeethStatus(recordData.teeth_status);
        }
      }

      // Fetch X-rays
      const { data: xrayData } = await supabase
        .from('xray_images')
        .select('*')
        .eq('patient_id', user.id)
        .order('created_at', { ascending: false });

      setPatientXrays(xrayData || []);
    }
  }, []);

  useEffect(() => {
    loadData();

    const updatesChannel = supabase
      .channel('patient_dashboard_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'medical_records' }, () =>
        loadData(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'xray_images' }, () =>
        loadData(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(updatesChannel);
    };
  }, [loadData]);

  const handleLogout = async () => {
    await apiClient.logout();
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-slate-50 flex relative">
      <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <User className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-slate-900">Patient Portal</span>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors',
              activeTab === 'dashboard'
                ? 'bg-indigo-50 text-indigo-600'
                : 'text-slate-600 hover:bg-slate-50',
            )}
          >
            <Calendar className="w-5 h-5" /> Dashboard
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors',
              activeTab === 'history'
                ? 'bg-indigo-50 text-indigo-600'
                : 'text-slate-600 hover:bg-slate-50',
            )}
          >
            <Clock className="w-5 h-5" /> History
          </button>
        </nav>
        <div className="p-4 border-t border-slate-100">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 hover:bg-red-50 font-medium transition-colors"
          >
            <LogOut className="w-5 h-5" /> Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto">
          <header className="mb-10">
            <h1 className="text-3xl font-bold text-slate-900">
              Welcome back, {profile?.full_name}
            </h1>
            <p className="text-slate-500">
              Manage your appointments and view your dental health status.
            </p>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              {activeTab === 'dashboard' ? (
                <>
                  {doctorAdvice && (
                    <div className="relative bg-amber-50 p-6 rounded-2xl shadow-md border border-amber-200 overflow-hidden">
                      <div className="absolute top-0 right-0 w-2 h-full bg-amber-400"></div>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-amber-100 rounded-full text-amber-600">
                          <FileText className="w-5 h-5" />
                        </div>
                        <h3 className="text-lg font-bold text-amber-900">Doctor's Note</h3>
                      </div>
                      <p className="text-amber-800 leading-relaxed bg-white/60 p-4 rounded-xl font-medium border border-amber-100/50 italic">
                        "{doctorAdvice}"
                      </p>
                    </div>
                  )}

                  <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h2 className="text-xl font-bold text-slate-900 mb-4">Appointments</h2>
                    <a href="/appointments" className="text-indigo-600 font-semibold">
                      Book, reschedule, cancel, and view appointment history
                    </a>
                  </section>

                  <section>
                    <h2 className="text-xl font-bold text-slate-900 mb-6">Your Dental Chart</h2>
                    <TeethChart status={teethStatus} />
                  </section>
                </>
              ) : (
                <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
                  <h2 className="text-2xl font-bold text-slate-900 mb-8">Medical History</h2>

                  <div className="space-y-10">
                    {/* Teeth Records */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-6 bg-indigo-600 rounded-full"></div>
                        <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">
                          Dental Chart Records
                        </h3>
                      </div>

                      {Object.keys(teethStatus).filter((id) => teethStatus[id] !== 'healthy')
                        .length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {Object.entries(teethStatus)
                            .filter(([_, status]) => status !== 'healthy')
                            .map(([id, status]) => (
                              <div
                                key={id}
                                className="group flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all duration-300"
                              >
                                <div className="w-12 h-12 bg-white text-indigo-600 rounded-xl flex items-center justify-center font-black shadow-sm group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                  {id}
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-slate-900 capitalize">
                                    {status.replace('_', ' ')}
                                  </p>
                                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                    Tooth Identification
                                  </p>
                                </div>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                          <p className="text-slate-400 text-sm">
                            No specific tooth treatments recorded yet.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}
            </div>

            <div className="space-y-8">
              <div className="bg-indigo-600 p-6 rounded-2xl text-white shadow-xl shadow-indigo-200">
                <h3 className="text-lg font-bold mb-2">Health Summary</h3>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="bg-white/10 p-3 rounded-xl">
                    <p className="text-[10px] uppercase font-bold text-indigo-200">Treatments</p>
                    <p className="text-xl font-bold">
                      {Object.values(teethStatus).filter((s) => s !== 'healthy').length}
                    </p>
                  </div>
                  <div className="bg-white/10 p-3 rounded-xl">
                    <p className="text-[10px] uppercase font-bold text-indigo-200">Next Visit</p>
                    <p className="text-xl font-bold">
                      <a href="/appointments">View calendar</a>
                    </p>
                  </div>
                </div>
              </div>

              {patientXrays.length > 0 && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                  <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Brain className="w-5 h-5 text-indigo-500" /> Archived X-Ray Scans
                  </h3>
                  <div className="space-y-4">
                    {patientXrays.map((xr) => (
                      <div
                        key={xr.id}
                        className="p-4 bg-slate-50 rounded-xl border border-slate-100"
                      >
                        <img
                          src={xr.image_url}
                          alt="X-ray Scan"
                          className="w-full h-32 object-cover rounded-lg mb-3 border border-slate-200"
                        />
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase">
                            {format(new Date(xr.created_at), 'dd MMMM yyyy')}
                          </p>
                          <p className="text-[10px] font-bold leading-relaxed text-amber-700">
                            Automated findings are withheld pending technical and clinical
                            validation.
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
