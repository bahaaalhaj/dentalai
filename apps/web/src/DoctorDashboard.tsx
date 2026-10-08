import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabase';
import { apiClient } from './lib/api-client';
import type { Profile, XrayImage } from './lib/supabase';
import { AnestheticCalculator } from './components/AnestheticCalculator';
import { BillingSection } from './components/BillingSection';
import type { DetectionBox, XrayAnalysisResult } from './lib/clinical-cv';
import { clinicalFeatureFlags, CLINICAL_FEATURE_UNAVAILABLE_MESSAGE } from './lib/feature-flags';
import {
  Users,
  Calendar,
  Search,
  Upload,
  Brain,
  ChevronRight,
  DollarSign,
  CheckCircle2,
  LogOut,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from './lib/utils';
import { format } from 'date-fns';

type SelectedPatient = Pick<Profile, 'id' | 'full_name'>;
type XrayReport = {
  cavities_detected: boolean;
  infected_teeth: number[];
  missing_teeth: number[];
  bone_loss: XrayAnalysisResult['boneLossLevel'];
  confidence: string;
  detections: DetectionBox[];
  other_findings: DetectionBox[];
};

export function DoctorDashboard() {
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    return tab === 'welcome' ? 'welcome' : 'welcome';
  });
  const [welcomeSection, setWelcomeSection] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('section') || 'overview';
  });
  //تخزين كل البيانات التي تتغير في الصفحة، مثل: حالة أسنان المريض، نتيجة تحليل الذكاء الاصطناعي للأشعة، قائمة المرضى، الإحصائيات (الأرباح، عدد المواعيد)، وبيانات التقويم
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatient | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('patientId');
    const name = params.get('patientName');
    return id ? { id, full_name: name ?? '' } : null;
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('tab', 'welcome');
    params.set('section', welcomeSection);
    if (selectedPatient) {
      params.set('patientId', selectedPatient.id);
      if (selectedPatient.full_name) params.set('patientName', selectedPatient.full_name);
    } else {
      params.delete('patientId');
      params.delete('patientName');
    }
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
  }, [activeTab, welcomeSection, selectedPatient]);

  const [isXrayAnalyzing, setIsXrayAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<XrayReport | null>(null);
  const [patientXrays, setPatientXrays] = useState<XrayImage[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Real Data State
  const [patients, setPatients] = useState<Profile[]>([]);
  const [stats, setStats] = useState({
    totalPatients: 0,
  });
  const [searchQuery, setSearchQuery] = useState('');

  // Memoized data fetching to prevent recreation
  const fetchInitialData = React.useCallback(async () => {
    try {
      // 1. Fetch Patients
      const { data: patientsData } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'patient')
        .order('created_at', { ascending: false });

      setPatients(patientsData || []);

      setStats({ totalPatients: patientsData?.length || 0 });
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  }, []);

  const loadPatientXrays = React.useCallback(async (_patientId: string) => {
    // Historical Supabase reports are not treated as clinical truth.
    setPatientXrays([]);
  }, []);

  useEffect(() => {
    void fetchInitialData();
    if (selectedPatient) void loadPatientXrays(selectedPatient.id);
  }, [fetchInitialData, loadPatientXrays, selectedPatient]);

  const analyzeXray = async (_file: File) => {
    // The legacy browser/Supabase path is permanently retired. Use /imaging.
    setIsXrayAnalyzing(false);
    setAiResult(null);
    setPreviewImage(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) analyzeXray(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      analyzeXray(file);
    }
  };

  const handleLogout = async () => {
    await apiClient.logout();
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-64 bg-slate-900 text-white hidden md:flex flex-col">
        <div className="p-6 border-b border-white/10 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Brain className="text-indigo-400 w-8 h-8" />
            <span className="font-bold text-xl">DentalAi</span>
          </div>
          <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
            Doctor Dashboard
          </span>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab('welcome')}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all',
              activeTab === 'welcome'
                ? 'bg-indigo-600 shadow-lg shadow-indigo-500/20 text-white'
                : 'text-slate-400 hover:text-white hover:bg-white/5',
            )}
          >
            <Brain className="w-5 h-5" />
            Welcome
          </button>
        </nav>
        <div className="p-4 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-900/10 font-medium transition-all"
          >
            <LogOut className="w-5 h-5" /> Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 capitalize">
              Welcome{welcomeSection ? ` / ${welcomeSection}` : ''}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold border-2 border-indigo-200">
              DR
            </div>
          </div>
        </header>
        {activeTab === 'welcome' && (
          <div className="bg-slate-50 border-b border-slate-200 px-8 py-4 sticky top-18 z-10">
            <div className="flex flex-wrap gap-3">
              {[
                { id: 'overview', label: 'Overview' },
                { id: 'patients', label: 'Patients' },
                { id: 'calendar', label: 'Calendar' },
                { id: 'billing', label: 'Billing' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setWelcomeSection(item.id)}
                  className={cn(
                    'rounded-full px-4 py-2 text-sm font-semibold transition-all',
                    welcomeSection === item.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="p-8">
          {activeTab === 'welcome' && welcomeSection === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  {
                    label: 'Total Patients',
                    value: stats.totalPatients,
                    icon: Users,
                    color: 'indigo',
                  },
                  {
                    label: 'Appointments',
                    value: <a href="/appointments">View calendar</a>,
                    icon: Calendar,
                    color: 'emerald',
                  },
                  {
                    label: 'Financial reports',
                    value: <a href="/billing">View issued ledger</a>,
                    icon: DollarSign,
                    color: 'amber',
                  },
                  {
                    label: 'Appointment history',
                    value: <a href="/appointments">View history</a>,
                    icon: CheckCircle2,
                    color: 'blue',
                  },
                ].map((stat, i) => (
                  <div
                    key={i}
                    className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div
                        className={cn(
                          'p-3 rounded-xl',
                          `bg-${stat.color}-50 text-${stat.color}-600`,
                        )}
                      >
                        <stat.icon className="w-6 h-6" />
                      </div>
                    </div>
                    <p className="text-slate-500 text-sm font-medium">{stat.label}</p>
                    <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                  <h3 className="text-lg font-bold text-slate-900 mb-6">Financial reports</h3>
                  <a href="/billing" className="text-indigo-600">
                    View issued invoices, payments, refunds and balances by currency.
                  </a>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                  <h3 className="text-lg font-bold text-slate-900 mb-6">Treatment Distribution</h3>
                  <p>
                    Clinical treatment reporting is unavailable here. Use the new clinical workspace
                    to review findings and procedures.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'welcome' && welcomeSection === 'billing' && (
            <BillingSection patients={patients} selectedPatientId={selectedPatient?.id} />
          )}

          {activeTab === 'welcome' && welcomeSection === 'calendar' && (
            <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
              <h2 className="text-2xl font-bold text-slate-900 mb-4">Clinic Schedule</h2>
              <a href="/appointments" className="text-indigo-600 font-semibold">
                Open the backend-owned calendar and appointment actions
              </a>
            </section>
          )}

          {activeTab === 'welcome' && welcomeSection === 'patients' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                  <div className="mb-6">
                    <h3 className="font-bold text-lg text-slate-900 mb-4">Patient Directory</h3>
                    <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200/50 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
                      <Search
                        className={cn(
                          'w-4 h-4',
                          searchQuery ? 'text-indigo-600' : 'text-slate-400',
                        )}
                      />
                      <input
                        type="text"
                        placeholder="Search by name..."
                        className="bg-transparent border-none outline-none text-xs w-full font-medium"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="p-1 hover:bg-slate-200 rounded-full"
                        >
                          <Plus className="w-3 h-3 text-slate-400 rotate-45" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2 max-h-150 overflow-y-auto pr-2 custom-scrollbar">
                    {(() => {
                      const query = searchQuery.toLowerCase().trim();
                      const filtered = patients.filter((p) => {
                        if (!query) return true;
                        const name = p.full_name?.toLowerCase() || '';
                        return (
                          name.split(' ').some((word) => word.startsWith(query)) ||
                          name.startsWith(query)
                        );
                      });

                      if (filtered.length === 0) {
                        return (
                          <p className="text-sm text-slate-400 text-center py-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                            No patients found
                          </p>
                        );
                      }
                      return filtered.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedPatient(p)}
                          className={cn(
                            'w-full flex items-center justify-between p-4 rounded-2xl transition-all border group/item',
                            selectedPatient?.id === p.id
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-100 shadow-lg'
                              : 'hover:bg-slate-50 border-transparent text-slate-600',
                          )}
                        >
                          <div className="flex items-center gap-3 text-left">
                            <div
                              className={cn(
                                'w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg',
                                selectedPatient?.id === p.id
                                  ? 'bg-white/20 text-white'
                                  : 'bg-indigo-50 text-indigo-600',
                              )}
                            >
                              {p.full_name?.charAt(0) || 'P'}
                            </div>
                            <div>
                              <p className="font-bold text-sm leading-none mb-1">{p.full_name}</p>
                              <p
                                className={cn(
                                  'text-[10px] font-medium opacity-60',
                                  selectedPatient?.id === p.id ? 'text-white' : 'text-slate-400',
                                )}
                              >
                                REG: {new Date(p.created_at).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              disabled
                              aria-label="Patient deletion unavailable pending record migration"
                              className={cn(
                                'p-2 rounded-lg transition-all opacity-0 group-hover/item:opacity-100',
                                selectedPatient?.id === p.id
                                  ? 'hover:bg-white/20 text-white'
                                  : 'hover:bg-red-50 text-slate-300 hover:text-red-500',
                              )}
                              title="Patient deletion is disabled to preserve historical appointments and clinical records"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <ChevronRight
                              className={cn(
                                'w-4 h-4',
                                selectedPatient?.id === p.id ? 'text-white' : 'text-slate-300',
                              )}
                            />
                          </div>
                        </button>
                      ));
                    })()}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2 space-y-8">
                {selectedPatient ? (
                  <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100 relative overflow-hidden">
                    <div className="flex items-center justify-between mb-10 pb-6 border-b border-slate-50">
                      <div>
                        <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-1">
                          {selectedPatient.full_name}
                        </h2>
                        <div className="flex gap-2">
                          <span className="px-3 py-1 bg-indigo-50 text-indigo-600 text-[10px] font-black rounded-lg uppercase">
                            Active Profile
                          </span>
                          <span className="px-3 py-1 bg-slate-50 text-slate-400 text-[10px] font-black rounded-lg uppercase">
                            ID: #{selectedPatient.id.slice(0, 8)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-10">
                      <section className="bg-slate-50 p-6 rounded-4xl border border-slate-100">
                        <h3 className="font-bold">Clinical records and odontogram</h3>
                        <p>
                          Legacy tooth cycling and instant advice publication have been retired.
                        </p>
                        <a href="/clinical/patients" className="text-indigo-600">
                          Open the clinician patient workspace
                        </a>
                      </section>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <section className="bg-white p-6 rounded-4xl border-2 border-slate-50">
                          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">
                            Experimental X-Ray Analysis
                          </h3>
                          {!clinicalFeatureFlags.xrayAnalysis ? (
                            <div
                              role="status"
                              className="p-5 rounded-2xl border border-amber-200 bg-amber-50 text-sm font-semibold leading-relaxed text-amber-900"
                            >
                              {CLINICAL_FEATURE_UNAVAILABLE_MESSAGE}
                            </div>
                          ) : (
                            <>
                              <div className="mb-4 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-xs font-bold leading-relaxed text-amber-900">
                                Development/demo use only. No validated inference runtime is
                                configured, so this module will not generate findings.
                              </div>
                              <div
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={cn(
                                  'relative border-2 border-dashed rounded-3xl overflow-hidden transition-all',
                                  previewImage
                                    ? 'border-indigo-200'
                                    : 'border-slate-100 p-10 text-center bg-slate-50/50 group cursor-pointer hover:bg-white hover:border-indigo-200',
                                )}
                              >
                                {previewImage ? (
                                  <div className="relative w-full aspect-video bg-slate-900 flex items-center justify-center">
                                    <img
                                      src={previewImage}
                                      alt="Preview"
                                      className="max-w-full max-h-full object-contain opacity-50"
                                    />

                                    {isXrayAnalyzing && (
                                      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] flex flex-col items-center justify-center gap-3">
                                        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                                        <p className="text-white text-xs font-bold uppercase tracking-widest animate-pulse">
                                          Processing Experimental Module...
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <>
                                    <input
                                      type="file"
                                      ref={fileInputRef}
                                      className="hidden"
                                      accept="image/*"
                                      onChange={handleFileSelect}
                                    />
                                    <Upload className="w-12 h-12 text-slate-200 mx-auto mb-4 group-hover:scale-110 group-hover:text-indigo-400 transition-all" />
                                    <p className="text-sm text-slate-400 font-medium mb-6">
                                      Drop X-ray scan here or click to browse
                                    </p>
                                    <div className="px-8 py-3 bg-white shadow-sm border border-slate-200 rounded-xl text-xs font-black text-slate-700 hover:shadow-md transition-all flex items-center gap-2 mx-auto w-fit">
                                      {isXrayAnalyzing ? 'Processing...' : 'Select X-ray Scan'}
                                      <Brain className="w-4 h-4 text-indigo-600" />
                                    </div>
                                  </>
                                )}
                              </div>

                              {previewImage && !isXrayAnalyzing && (
                                <button
                                  onClick={() => {
                                    setPreviewImage(null);
                                    setAiResult(null);
                                  }}
                                  className="mt-4 w-full py-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors flex items-center justify-center gap-2"
                                >
                                  <Plus className="w-3 h-3 rotate-45" /> Clear and Scan Another
                                </button>
                              )}

                              {aiResult && !isXrayAnalyzing && (
                                <div className="mt-6 p-5 bg-emerald-50 rounded-2xl border border-emerald-100 animate-in fade-in slide-in-from-bottom-4 shadow-sm">
                                  <div className="flex items-center gap-2 mb-3">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                    <span className="font-bold text-sm text-emerald-900 uppercase">
                                      Unvalidated Output Saved ({aiResult.confidence})
                                    </span>
                                  </div>
                                  <ul className="text-xs text-emerald-700 space-y-2 font-medium">
                                    <li className="flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
                                      Experimental output:{' '}
                                      {aiResult.infected_teeth.length > 0
                                        ? `Caries/Cavity markers on Teeth ${aiResult.infected_teeth.join(', ')}`
                                        : 'No markers produced'}
                                    </li>
                                    <li className="flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
                                      Missing:{' '}
                                      {aiResult.missing_teeth?.length > 0
                                        ? aiResult.missing_teeth.join(', ')
                                        : 'None'}
                                    </li>
                                    <li className="flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
                                      Other Findings:{' '}
                                      {aiResult.other_findings.length > 0
                                        ? aiResult.other_findings
                                            .map(
                                              (finding) =>
                                                `${finding.label} (T${finding.toothNumber})`,
                                            )
                                            .join(', ')
                                        : 'None'}
                                    </li>
                                    <li className="flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
                                      Bone level: {aiResult.bone_loss}
                                    </li>
                                  </ul>
                                </div>
                              )}

                              {patientXrays.length > 0 && (
                                <div className="mt-8 space-y-4">
                                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">
                                    X-Ray History
                                  </h4>
                                  <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    {patientXrays.map((xr) => (
                                      <div
                                        key={xr.id}
                                        className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex flex-col gap-2"
                                      >
                                        <img
                                          src={xr.image_url}
                                          alt="Xray"
                                          className="w-full h-24 object-cover rounded-xl border border-slate-200"
                                        />
                                        <div className="flex items-center justify-between">
                                          <p className="text-[9px] font-bold text-slate-500 uppercase">
                                            {format(new Date(xr.created_at), 'dd MMM yyyy')}
                                          </p>
                                          <span className="text-[8px] font-black bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded uppercase">
                                            Unvalidated record
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </section>

                        <div className="bg-slate-50 p-6 rounded-4xl border border-slate-100 shadow-inner">
                          <AnestheticCalculator patientId={selectedPatient.id} />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full min-h-150 flex flex-col items-center justify-center bg-white rounded-[40px] border border-dashed border-slate-200 p-20 text-center">
                    <div className="w-24 h-24 bg-indigo-50 rounded-4xl flex items-center justify-center mb-6">
                      <Users className="w-12 h-12 text-indigo-200" />
                    </div>
                    <h3 className="text-2xl font-bold text-slate-400 mb-2">
                      Clinical Selection Required
                    </h3>
                    <p className="text-slate-300 max-w-xs mx-auto">
                      Select a patient from the directory to access their records, digital twin, and
                      send clinical advice.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
