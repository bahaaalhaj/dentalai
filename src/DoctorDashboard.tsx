import React, { useState, useEffect, useRef } from 'react';
import { supabase, Profile, Appointment, ToothStatus } from './lib/supabase';
import { TeethChart } from './components/TeethChart';
import { AnestheticCalculator } from './components/AnestheticCalculator';
import { BillingSection } from './components/BillingSection';
import { ClinicalProcessor } from './lib/clinical-cv';
import { 
  Users, Calendar, FileText, BarChart3, Settings, 
  Search, Bell, Upload, Brain, ChevronRight,
  DollarSign, CheckCircle2, LogOut, MessageSquare, Plus,
  Clock, Activity, Trash2
} from 'lucide-react';
import { cn } from './lib/utils';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell 
} from 'recharts';
import { format } from 'date-fns';

const COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444'];

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
  const [selectedPatient, setSelectedPatient] = useState<any>(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('patientId');
    const name = params.get('patientName');
    return id ? { id, full_name: name } : null;
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

  const [teethStatus, setTeethStatus] = useState<ToothStatus>({});
  const [isXrayAnalyzing, setIsXrayAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [patientXrays, setPatientXrays] = useState<any[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Real Data State
  const [patients, setPatients] = useState<Profile[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [stats, setStats] = useState({
    totalPatients: 0,
    todayAppointments: 0,
    revenue: 0,
    successRate: 0
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [pieData, setPieData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Calendar specific state
  const [calendarDate, setCalendarDate] = useState(new Date().toISOString().split('T')[0]);
  const [dayAppointments, setDayAppointments] = useState<any[]>([]);
  
  // Patient Medical Advice state
  const [doctorAdvice, setDoctorAdvice] = useState('');
  const [savingAdvice, setSavingAdvice] = useState(false);

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

      // 2. Fetch Appointments
      const { data: apptsData } = await supabase
        .from('appointments')
        .select('*, patient:profiles!patient_id(full_name)')
        .order('date', { ascending: true });
      
      // Auto-cleanup past booked appointments
      const now = new Date();
      const todayString = format(now, 'yyyy-MM-dd');
      const currentTime = format(now, 'HH:mm');

      const pastBooked = apptsData?.filter(a => 
        a.status === 'booked' && 
        (a.date < todayString || (a.date === todayString && a.time < currentTime))
      ) || [];

      if (pastBooked.length > 0) {
        await supabase.from('appointments').delete().in('id', pastBooked.map(a => a.id));
      }

      const validAppts = apptsData?.filter(a => 
        !pastBooked.find(p => p.id === a.id)
      ) || [];

      setAppointments(validAppts);

      // 3. Fetch Payments for total revenue
      const { data: paymentsData } = await supabase
        .from('payments')
        .select('*');

      // 4. Fetch Medical Records for Treatment Distribution
      const { data: recordsData } = await supabase
        .from('medical_records')
        .select('teeth_status');

      // 5. Calculate Stats
      const todayAppts = validAppts.filter(a => a.date === todayString).length;
      const completedAppts = validAppts.filter(a => a.status === 'completed').length;
      const totalAppts = validAppts.length;
      
      const revenue = paymentsData?.reduce((sum, p) => sum + p.amount_sp, 0) || 0;
      const successRate = totalAppts > 0 ? Math.round((completedAppts / totalAppts) * 100) : 100;

      setStats({
        totalPatients: patientsData?.length || 0,
        todayAppointments: todayAppts,
        revenue,
        successRate
      });

      // 6. Prepare Chart Data (Revenue Growth)
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const currentMonth = new Date().getMonth();
      const last6Months: { name: string; revenue: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const m = (currentMonth - i + 12) % 12;
        last6Months.push({ name: months[m], revenue: 0 });
      }

      paymentsData?.forEach(p => {
        const date = new Date(p.created_at);
        const monthName = months[date.getMonth()];
        const chartItem = last6Months.find(item => item.name === monthName);
        if (chartItem) chartItem.revenue += p.amount_sp;
      });
      setChartData(last6Months);

      // 7. Prepare Pie Data
      const distribution: Record<string, number> = {
        'Healthy': 0, 'Cavity': 0, 'Filling': 0, 'Root Canal': 0, 'Extracted': 0, 'Crown': 0, 'Implant': 0
      };

      recordsData?.forEach(r => {
        const status = r.teeth_status as ToothStatus;
        if (status) {
          Object.values(status).forEach(s => {
            const label = s.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            if (distribution[label] !== undefined) distribution[label]++;
          });
        }
      });

      const formattedPieData = Object.entries(distribution)
        .filter(([_, value]) => value > 0)
        .map(([name, value]) => ({ name, value }));
      
      setPieData(formattedPieData.length > 0 ? formattedPieData : [{ name: 'No Data', value: 1 }]);

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDayAppointments = React.useCallback(async (date: string) => {
    const { data, error } = await supabase
      .from('appointments')
      .select('*, patient:profiles!patient_id(full_name)')
      .eq('date', date)
      .order('time', { ascending: true });

    if (error) {
      console.error("Error loading day appointments:", error);
      return;
    }
    
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const currTime = format(now, 'HH:mm');

    const filtered = data?.filter(a => {
      // Show everything except oldbooked ones that should have been auto-cleaned
      // But keep cancelled/completed for historical record of the day
      if (a.status !== 'booked') return true;
      if (a.date > todayStr) return true;
      if (a.date === todayStr && a.time >= currTime) return true;
      return false;
    }) || [];

    setDayAppointments(filtered);
  }, []);

  const loadPatientAdvice = React.useCallback(async (patientId: string) => {
    const { data } = await supabase
      .from('medical_records')
      .select('medical_history, teeth_status')
      .eq('patient_id', patientId)
      .single();
    
    setDoctorAdvice(data?.medical_history || '');
    setTeethStatus(data?.teeth_status || {});
  }, []);

  const loadPatientXrays = React.useCallback(async (patientId: string) => {
    const { data } = await supabase
      .from('xray_images')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    
    setPatientXrays(data || []);
  }, []);

  useEffect(() => {
    fetchInitialData();

    // Centralized real-time subscription
    const dashboardSubscription = supabase
      .channel('doctor_dashboard_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
        fetchInitialData();
        loadDayAppointments(calendarDate);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'medical_records' }, (payload: any) => {
        fetchInitialData();
        if (selectedPatient && payload.new.patient_id === selectedPatient.id) {
           loadPatientAdvice(selectedPatient.id);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'xray_images' }, (payload: any) => {
        if (selectedPatient && payload.new.patient_id === selectedPatient.id) {
          loadPatientXrays(selectedPatient.id);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        fetchInitialData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(dashboardSubscription);
    };
  }, [fetchInitialData, loadDayAppointments, loadPatientAdvice, loadPatientXrays, calendarDate, selectedPatient]);

  useEffect(() => {
    if (activeTab === 'welcome' && welcomeSection === 'calendar') {
      loadDayAppointments(calendarDate);
    }
  }, [activeTab, welcomeSection, calendarDate, loadDayAppointments]);

  useEffect(() => {
    if (selectedPatient) {
      loadPatientAdvice(selectedPatient.id);
      loadPatientXrays(selectedPatient.id);
    }
  }, [selectedPatient, loadPatientAdvice, loadPatientXrays]);

  const handleSaveAdvice = async () => {
    if (!selectedPatient) return;
    setSavingAdvice(true);
    
    const { error } = await supabase
      .from('medical_records')
      .upsert({ 
        patient_id: selectedPatient.id, 
        medical_history: doctorAdvice,
        updated_at: new Date().toISOString()
      }, { onConflict: 'patient_id' });

    if (!error) alert("Advice saved successfully and sent to patient's dashboard!");
    else alert("Error saving advice: " + error.message);
    
    setSavingAdvice(false);
  };

  const handleDeletePatient = async (e: React.MouseEvent, patientId: string) => {
    e.stopPropagation(); // Prevent selecting the patient when clicking delete
    
    if (confirm("Are you sure you want to delete this patient? This will remove all their records, appointments, and medical history permanently.")) {
      try {
        // In a real app with proper foreign keys, you might just delete the profile.
        // Here we delete dependent records first for safety if cascades aren't fully set.
        await supabase.from('appointments').delete().eq('patient_id', patientId);
        await supabase.from('medical_records').delete().eq('patient_id', patientId);
        await supabase.from('xray_images').delete().eq('patient_id', patientId);
        await supabase.from('payments').delete().eq('patient_id', patientId);
        
        const { error } = await supabase
          .from('profiles')
          .delete()
          .eq('id', patientId);

        if (error) throw error;

        setPatients(patients.filter(p => p.id !== patientId));
        if (selectedPatient?.id === patientId) {
          setSelectedPatient(null);
        }
        alert("Patient record deleted successfully.");
      } catch (error) {
        console.error("Error deleting patient:", error);
        alert("Error deleting patient: " + (error instanceof Error ? error.message : "Unknown error"));
      }
    }
  };

  const handleToothClick = async (id: string) => {
    if (!selectedPatient) return;
    const current = teethStatus[id] || 'healthy';
    const next: any = {
      'healthy': 'cavity',
      'cavity': 'filling',
      'filling': 'root_canal',
      'root_canal': 'extracted',
      'extracted': 'crown',
      'crown': 'implant',
      'implant': 'healthy'
    };
    const newStatus = { ...teethStatus, [id]: next[current] };
    setTeethStatus(newStatus);

    await supabase.from('medical_records').upsert({
      patient_id: selectedPatient.id,
      teeth_status: newStatus,
      updated_at: new Date().toISOString()
    }, { onConflict: 'patient_id' });
  };

  const analyzeXray = async (file: File) => {
    if (!selectedPatient) return;
    setIsXrayAnalyzing(true);
    setAiResult(null);
    
    try {
      // 0. Show local preview
      const reader = new FileReader();
      reader.onload = (e) => setPreviewImage(e.target?.result as string);
      reader.readAsDataURL(file);

      // 1. Run local clinical analysis
      const result = await ClinicalProcessor.analyze(file);
      
      const analysisData = {
        cavities_detected: result.cavities.length > 0,
        infected_teeth: result.cavities,
        missing_teeth: result.missingTeeth,
        bone_loss: result.boneLossLevel,
        confidence: `${Math.round(result.confidence * 100)}%`,
        detections: result.detections,
        other_findings: result.detections.filter(d => !['Caries', 'Cavity'].includes(d.label))
      };

      setAiResult(analysisData);

      // 2. Upload image to Supabase Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${selectedPatient.id}/${Math.random()}.${fileExt}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('xrays')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('xrays').getPublicUrl(uploadData.path);

      // 3. Clear previous X-rays for this patient
      await supabase.from('xray_images').delete().eq('patient_id', selectedPatient.id);

      // 4. Save Record to Database
      const { error: dbError } = await supabase.from('xray_images').insert([{
        patient_id: selectedPatient.id,
        image_url: publicUrl,
        ai_report: analysisData
      }]);

      if (dbError) throw dbError;

      // 5. Refresh Xray History
      await loadPatientXrays(selectedPatient.id);
      
    }  catch (error) {
      console.error("Clinical Processor/Save Error:", error);
      alert("Error saving X-ray: " + (error instanceof Error ? error.message : "Unknown error"));
      
      // --- التعديل: مسح الصورة غير الصالحة والنتائج من الشاشة ---
      setPreviewImage(null);
      setAiResult(null);
      // ---------------------------------------------------------

    } finally {
      setIsXrayAnalyzing(false);
    }
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
    await supabase.auth.signOut();
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
          <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Doctor Dashboard</span>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab('welcome')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all",
              activeTab === 'welcome' ? "bg-indigo-600 shadow-lg shadow-indigo-500/20 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
            )}
          >
            <Brain className="w-5 h-5" />
            Welcome
          </button>
        </nav>
        <div className="p-4 border-t border-white/10">
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-900/10 font-medium transition-all">
            <LogOut className="w-5 h-5" /> Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 capitalize">Welcome{welcomeSection ? ` / ${welcomeSection}` : ''}</h1>
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
                    "rounded-full px-4 py-2 text-sm font-semibold transition-all",
                    welcomeSection === item.id ? "bg-indigo-600 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
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
                  { label: 'Total Patients', value: stats.totalPatients, icon: Users, color: 'indigo' },
                  { label: 'Appointments Today', value: stats.todayAppointments, icon: Calendar, color: 'emerald' },
                  { label: 'Total Revenue', value: `${stats.revenue.toLocaleString()} S.P.`, icon: DollarSign, color: 'amber' },
                  { label: 'Success Rate', value: `${stats.successRate}%`, icon: CheckCircle2, color: 'blue' },
                ].map((stat, i) => (
                  <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                      <div className={cn("p-3 rounded-xl", `bg-${stat.color}-50 text-${stat.color}-600`)}>
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
                  <h3 className="text-lg font-bold text-slate-900 mb-6">Revenue Growth</h3>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                        <Bar dataKey="revenue" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                  <h3 className="text-lg font-bold text-slate-900 mb-6">Treatment Distribution</h3>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'welcome' && welcomeSection === 'billing' && (
            <BillingSection 
              patients={patients} 
              selectedPatientId={selectedPatient?.id} 
            />
          )}

          {activeTab === 'welcome' && welcomeSection === 'calendar' && (
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 min-h-150">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-slate-900 uppercase tracking-tight">Clinic Schedule</h2>
                <div className="flex items-center gap-4">
                  <div className="bg-slate-50 p-2 rounded-xl flex items-center gap-2 border border-slate-200">
                     <label className="text-xs font-bold text-slate-400 uppercase pr-2 border-r border-slate-200">Date Selector</label>
                     <input 
                      type="date" 
                      className="bg-transparent text-sm font-bold text-indigo-600 outline-none"
                      value={calendarDate}
                      onChange={(e) => setCalendarDate(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b pb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Appointments for {format(new Date(calendarDate), 'MMMM dd, yyyy')}
                </h3>
                {dayAppointments.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4">
                    {dayAppointments.map((appt) => (
                      <div key={appt.id} className="flex items-center gap-6 p-5 border border-slate-100 rounded-2xl hover:shadow-lg hover:border-indigo-100 transition-all bg-white relative overflow-hidden group">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-600"></div>
                        <div className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl font-black text-xl min-w-25 text-center border border-indigo-100">
                          {appt.time}
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-slate-900 text-lg">{appt.patient?.full_name || 'Unknown Patient'}</p>
                          <div className="flex gap-2 items-center mt-1">
                            <span className={cn(
                              "text-[10px] uppercase font-black px-2 py-0.5 rounded",
                              appt.status === 'booked' ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                            )}>
                              {appt.status}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium tracking-tighter">REF: {appt.id.slice(0, 8)}</span>
                          </div>
                        </div>
                        <button onClick={() => { setSelectedPatient({id: appt.patient_id, full_name: appt.patient?.full_name}); setWelcomeSection('patients'); }} className="opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-600 text-white p-2 rounded-lg">
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-20 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                    <Calendar className="w-16 h-16 mx-auto mb-4 text-slate-200" />
                    <p className="text-slate-400 font-medium">No appointments scheduled for this date.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'welcome' && welcomeSection === 'patients' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                  <div className="mb-6">
                    <h3 className="font-bold text-lg text-slate-900 mb-4">Patient Directory</h3>
                    <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200/50 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
                      <Search className={cn("w-4 h-4", searchQuery ? "text-indigo-600" : "text-slate-400")} />
                      <input 
                        type="text" 
                        placeholder="Search by name..." 
                        className="bg-transparent border-none outline-none text-xs w-full font-medium"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="p-1 hover:bg-slate-200 rounded-full">
                          <Plus className="w-3 h-3 text-slate-400 rotate-45" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2 max-h-150 overflow-y-auto pr-2 custom-scrollbar">
                    {(() => {
                      const query = searchQuery.toLowerCase().trim();
                      const filtered = patients.filter(p => {
                        if (!query) return true;
                        const name = p.full_name?.toLowerCase() || '';
                        return name.split(' ').some(word => word.startsWith(query)) || name.startsWith(query);
                      });

                      if (filtered.length === 0) {
                        return <p className="text-sm text-slate-400 text-center py-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200">No patients found</p>;
                      }
                      return filtered.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedPatient(p)}
                          className={cn(
                            "w-full flex items-center justify-between p-4 rounded-2xl transition-all border group/item",
                            selectedPatient?.id === p.id ? "bg-indigo-600 text-white border-indigo-600 shadow-indigo-100 shadow-lg" : "hover:bg-slate-50 border-transparent text-slate-600"
                          )}
                        >
                          <div className="flex items-center gap-3 text-left">
                            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg", selectedPatient?.id === p.id ? "bg-white/20 text-white" : "bg-indigo-50 text-indigo-600")}>
                              {p.full_name?.charAt(0) || 'P'}
                            </div>
                            <div>
                              <p className="font-bold text-sm leading-none mb-1">{p.full_name}</p>
                              <p className={cn("text-[10px] font-medium opacity-60", selectedPatient?.id === p.id ? "text-white" : "text-slate-400")}>REG: {new Date(p.created_at).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => handleDeletePatient(e, p.id)}
                              className={cn(
                                "p-2 rounded-lg transition-all opacity-0 group-hover/item:opacity-100",
                                selectedPatient?.id === p.id ? "hover:bg-white/20 text-white" : "hover:bg-red-50 text-slate-300 hover:text-red-500"
                              )}
                              title="Delete Patient"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <ChevronRight className={cn("w-4 h-4", selectedPatient?.id === p.id ? "text-white" : "text-slate-300")} />
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
                        <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-1">{selectedPatient.full_name}</h2>
                        <div className="flex gap-2">
                           <span className="px-3 py-1 bg-indigo-50 text-indigo-600 text-[10px] font-black rounded-lg uppercase">Active Profile</span>
                           <span className="px-3 py-1 bg-slate-50 text-slate-400 text-[10px] font-black rounded-lg uppercase">ID: #{selectedPatient.id.slice(0, 8)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-10">
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                        <section className="bg-slate-50 p-6 rounded-4xl border border-slate-100">
                          <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                            <Activity className="w-4 h-4 text-indigo-500" /> Digital Teeth Chart 
                          </h3>
                          <TeethChart status={teethStatus} onToothClick={handleToothClick} interactive />
                        </section>

                        <section className="space-y-6">
                          <div className="bg-indigo-600 rounded-4xl p-6 shadow-2xl shadow-indigo-200 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10"><MessageSquare className="w-20 h-20" /></div>
                            <div className="flex items-center gap-2 mb-4 relative z-10">
                              <div className="p-2 bg-white/20 rounded-xl"><FileText className="w-5 h-5 text-white" /></div>
                              <h3 className="font-bold text-white text-lg">Doctor's Instructions</h3>
                            </div>
                            <textarea
                              className="w-full p-4 rounded-2xl bg-white/10 border border-white/20 text-white placeholder:text-indigo-200 outline-none focus:ring-4 focus:ring-white/10 mb-4 h-40 resize-none font-medium leading-relaxed"
                              placeholder="Type advice that the patient will see on their dashboard instantly..."
                              value={doctorAdvice}
                              onChange={(e) => setDoctorAdvice(e.target.value)}
                            />
                            <button 
                              onClick={handleSaveAdvice}
                              disabled={savingAdvice}
                              className="w-full bg-white text-indigo-600 font-bold py-4 rounded-2xl hover:shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                              {savingAdvice ? "Processing..." : "Submit Advice"}
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </section>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <section className="bg-white p-6 rounded-4xl border-2 border-slate-50">
                          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">X-Ray AI Diagnostic</h3>
                          <div 
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={cn(
                              "relative border-2 border-dashed rounded-3xl overflow-hidden transition-all",
                              previewImage ? "border-indigo-200" : "border-slate-100 p-10 text-center bg-slate-50/50 group cursor-pointer hover:bg-white hover:border-indigo-200"
                            )}
                          >
                            {previewImage ? (
                              <div className="relative w-full aspect-video bg-slate-900 flex items-center justify-center">
                                <img src={previewImage} alt="Preview" className="max-w-full max-h-full object-contain opacity-50" />
                                
                                {isXrayAnalyzing && (
                                  <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] flex flex-col items-center justify-center gap-3">
                                    <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                                    <p className="text-white text-xs font-bold uppercase tracking-widest animate-pulse">Running YOLO Engine...</p>
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
                                <p className="text-sm text-slate-400 font-medium mb-6">Drop X-ray scan here or click to browse</p>
                                <div className="px-8 py-3 bg-white shadow-sm border border-slate-200 rounded-xl text-xs font-black text-slate-700 hover:shadow-md transition-all flex items-center gap-2 mx-auto w-fit">
                                  {isXrayAnalyzing ? "AI is Analyzing..." : "Select X-ray Scan"}
                                  <Brain className="w-4 h-4 text-indigo-600" />
                                </div>
                              </>
                            )}
                          </div>

                          {previewImage && !isXrayAnalyzing && (
                            <button 
                              onClick={() => { setPreviewImage(null); setAiResult(null); }}
                              className="mt-4 w-full py-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors flex items-center justify-center gap-2"
                            >
                              <Plus className="w-3 h-3 rotate-45" /> Clear and Scan Another
                            </button>
                          )}

                          {aiResult && !isXrayAnalyzing && (
                            <div className="mt-6 p-5 bg-emerald-50 rounded-2xl border border-emerald-100 animate-in fade-in slide-in-from-bottom-4 shadow-sm">
                              <div className="flex items-center gap-2 mb-3">
                                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                <span className="font-bold text-sm text-emerald-900 uppercase">Analysis Saved ({aiResult.confidence})</span>
                              </div>
                              <ul className="text-xs text-emerald-700 space-y-2 font-medium">
                                <li className="flex items-center gap-2">
                                   <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
                                   Diagnostic: {aiResult.infected_teeth.length > 0 ? `Caries/Cavity on Teeth ${aiResult.infected_teeth.join(', ')}` : 'No Caries Detected'}
                                </li>
                                <li className="flex items-center gap-2">
                                   <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
                                   Missing: {aiResult.missing_teeth?.length > 0 ? aiResult.missing_teeth.join(', ') : 'None'}
                                </li>
                                <li className="flex items-center gap-2">
                                   <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
                                   Other Findings: {aiResult.other_findings?.length > 0 ? aiResult.other_findings.map((f: any) => `${f.label} (T${f.toothNumber})`).join(', ') : 'None'}
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
                              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">X-Ray History</h4>
                              <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                {patientXrays.map((xr) => (
                                  <div key={xr.id} className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex flex-col gap-2">
                                    <img src={xr.image_url} alt="Xray" className="w-full h-24 object-cover rounded-xl border border-slate-200" />
                                    <div className="flex items-center justify-between">
                                      <p className="text-[9px] font-bold text-slate-500 uppercase">{format(new Date(xr.created_at), 'dd MMM yyyy')}</p>
                                      <span className="text-[8px] font-black bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded uppercase">Verified</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
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
                    <h3 className="text-2xl font-bold text-slate-400 mb-2">Clinical Selection Required</h3>
                    <p className="text-slate-300 max-w-xs mx-auto">Select a patient from the directory to access their records, digital twin, and send clinical advice.</p>
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
