import React, { useState, useEffect } from 'react';
import { supabase, Profile, Appointment, ToothStatus } from './lib/supabase';
import { TeethChart } from './components/TeethChart';
import { Calendar, Clock, User, LogOut, ChevronRight, Plus, X, Trash2, FileText, Brain, History as HistoryIcon } from 'lucide-react';
import { format, getDay } from 'date-fns';
import { cn } from './lib/utils';

// تم تعديل المواعيد لتصبح من 8:00 AM حتى 5:00 PM
const TIME_SLOTS = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
  "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00"
];

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
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [teethStatus, setTeethStatus] = useState<ToothStatus>({});
  const [doctorAdvice, setDoctorAdvice] = useState<string | null>(null);
  const [patientXrays, setPatientXrays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal and Booking States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  
  // Custom Time Selector States
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);

  // Fetch booked slots whenever the date changes
  useEffect(() => {
    if (selectedDate) {
      checkBookedSlots(selectedDate);
      setSelectedTime(''); // Reset time when date changes
    }
  }, [selectedDate]);

  const loadData = React.useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile(profileData);

      const { data: apptData } = await supabase.from('appointments').select('*').eq('patient_id', user.id).order('date', { ascending: true });
      
      // Auto-cleanup past booked appointments
      const now = new Date();
      const todayString = format(now, 'yyyy-MM-dd');
      const currentTime = format(now, 'HH:mm');

      const pastBooked = apptData?.filter(a => 
        a.status === 'booked' && 
        (a.date < todayString || (a.date === todayString && a.time < currentTime))
      ) || [];

      if (pastBooked.length > 0) {
        await supabase.from('appointments').delete().in('id', pastBooked.map(a => a.id));
      }

      const validAppts = apptData?.filter(a => 
        !pastBooked.find(p => p.id === a.id)
      ) || [];

      setAppointments(validAppts);

      const { data: recordData } = await supabase.from('medical_records').select('medical_history, teeth_status').eq('patient_id', user.id).single();
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
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();

    const updatesChannel = supabase
      .channel('patient_dashboard_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'medical_records' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'xray_images' }, () => loadData())
      .subscribe();

    return () => {
      supabase.removeChannel(updatesChannel);
    };
  }, [loadData]);

  async function checkBookedSlots(date: string) {
    const { data } = await supabase
      .from('appointments')
      .select('time')
      .eq('date', date);
    
    if (data) {
      const times = data.map(appt => appt.time.slice(0, 5));
      setBookedSlots(times);
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this appointment?")) {
      const { error } = await supabase.from('appointments').delete().eq('id', id);
      if (!error) setAppointments(appointments.filter(a => a.id !== id));
      else alert("Error deleting appointment: " + error.message);
    }
  };

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !selectedTime) return alert("Please select a date and time slot.");
    
    // Check if Friday (Holiday)
    const dateObj = new Date(selectedDate);
    if (dateObj.getDay() === 5) {
      return alert("The clinic is closed on Fridays. Please select another day.");
    }
    
    setBookingLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      const { error } = await supabase.from('appointments').insert([
        {
          patient_id: user.id,
          date: selectedDate,
          time: selectedTime,
          status: 'booked',
          confirmation_status: 'pending'
        }
      ]);

      if (!error) {
        setIsModalOpen(false);
        setSelectedDate('');
        setSelectedTime('');
        await loadData();
      } else {
        alert("Error booking appointment: " + error.message);
      }
    }
    setBookingLoading(false);
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
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors",
              activeTab === 'dashboard' ? "bg-indigo-50 text-indigo-600" : "text-slate-600 hover:bg-slate-50"
            )}
          >
            <Calendar className="w-5 h-5" /> Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors",
              activeTab === 'history' ? "bg-indigo-50 text-indigo-600" : "text-slate-600 hover:bg-slate-50"
            )}
          >
            <Clock className="w-5 h-5" /> History
          </button>
        </nav>
        <div className="p-4 border-t border-slate-100">
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 hover:bg-red-50 font-medium transition-colors">
            <LogOut className="w-5 h-5" /> Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto">
          <header className="mb-10">
            <h1 className="text-3xl font-bold text-slate-900">Welcome back, {profile?.full_name}</h1>
            <p className="text-slate-500">Manage your appointments and view your dental health status.</p>
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
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-xl font-bold text-slate-900">Upcoming Appointments</h2>
                      <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 text-indigo-600 font-semibold text-sm hover:underline">
                        <Plus className="w-4 h-4" /> Book New
                      </button>
                    </div>
                    
                    {appointments.filter(a => a.status === 'booked').length > 0 ? (
                      <div className="space-y-4">
                        {appointments.filter(a => a.status === 'booked').map((appt) => (
                          <div key={appt.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 hover:border-indigo-100 transition-colors">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-slate-50 rounded-xl flex flex-col items-center justify-center text-slate-600">
                                <span className="text-[10px] font-bold uppercase">{format(new Date(appt.date), 'MMM')}</span>
                                <span className="text-lg font-bold leading-none">{format(new Date(appt.date), 'dd')}</span>
                              </div>
                              <div>
                                <p className="font-bold text-slate-900">{appt.time}</p>
                                <p className="text-sm text-slate-500 capitalize">{appt.status}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => handleDelete(appt.id)} className="text-slate-400 hover:text-red-600 transition-colors p-2">
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-500">No upcoming appointments.</p>
                      </div>
                    )}
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
                        <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Dental Chart Records</h3>
                      </div>
                      
                      {Object.keys(teethStatus).filter(id => teethStatus[id] !== 'healthy').length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {Object.entries(teethStatus)
                            .filter(([_, status]) => status !== 'healthy')
                            .map(([id, status]) => (
                               <div key={id} className="group flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all duration-300">
                                 <div className="w-12 h-12 bg-white text-indigo-600 rounded-xl flex items-center justify-center font-black shadow-sm group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                   {id}
                                 </div>
                                 <div>
                                   <p className="text-sm font-bold text-slate-900 capitalize">
                                     {status.replace('_', ' ')}
                                   </p>
                                   <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Tooth Identification</p>
                                 </div>
                               </div>
                            ))}
                        </div>
                      ) : (
                        <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                          <p className="text-slate-400 text-sm">No specific tooth treatments recorded yet.</p>
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
                    <p className="text-xl font-bold">{Object.values(teethStatus).filter(s => s !== 'healthy').length}</p>
                  </div>
                  <div className="bg-white/10 p-3 rounded-xl">
                    <p className="text-[10px] uppercase font-bold text-indigo-200">Next Visit</p>
                    <p className="text-xl font-bold">{appointments.filter(a => a.status === 'booked').length > 0 ? format(new Date(appointments.filter(a => a.status === 'booked')[0].date), 'dd MMM') : 'Soon'}</p>
                  </div>
                </div>
              </div>

              {patientXrays.length > 0 && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                  <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Brain className="w-5 h-5 text-indigo-500" /> Clinical Scans
                  </h3>
                  <div className="space-y-4">
                    {patientXrays.map((xr) => (
                      <div key={xr.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <img src={xr.image_url} alt="X-ray Scan" className="w-full h-32 object-cover rounded-lg mb-3 border border-slate-200" />
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase">{format(new Date(xr.created_at), 'dd MMMM yyyy')}</p>
                          <div className="flex flex-wrap gap-1">
                            <span className="text-[9px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">
                              Bone Loss: {xr.ai_report?.bone_loss}
                            </span>
                            {xr.ai_report?.infected_teeth?.length > 0 && (
                              <span className="text-[9px] font-bold px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                                Cavities: {xr.ai_report.infected_teeth.join(', ')}
                              </span>
                            )}
                          </div>
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

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900">Book New Appointment</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-2">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleBook} className="p-6 flex flex-col md:flex-row gap-8">
              <div className="md:w-1/3 border-r border-slate-100 pr-4">
                <label className="block text-sm font-semibold text-slate-700 mb-4">1. Select Date</label>
                <input 
                  type="date" 
                  required
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
                {selectedDate && (
                  new Date(selectedDate).getDay() === 5 ? (
                    <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-xl text-xs font-bold border border-red-100 flex items-center gap-2">
                      <X className="w-4 h-4" /> Clinic Holiday (Friday)
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 mt-4 text-center">
                      Fetching availability...
                    </p>
                  )
                )}
              </div>

              <div className="md:w-2/3">
                <label className="block text-sm font-semibold text-slate-700 mb-4">2. Select Time (8 AM - 5 PM)</label>
                
                {!selectedDate ? (
                  <div className="h-48 flex items-center justify-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <p className="text-slate-400">Please select a date first</p>
                  </div>
                ) : new Date(selectedDate).getDay() === 5 ? (
                  <div className="h-48 flex flex-col items-center justify-center bg-red-50 rounded-xl border border-dashed border-red-200 text-center px-4">
                    <X className="w-12 h-12 text-red-300 mb-2" />
                    <p className="text-red-600 font-bold">Closed on Fridays</p>
                    <p className="text-red-500 text-xs">The clinic is on weekly holiday. Please choose another day.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                    {TIME_SLOTS.map((time) => {
                      const isBooked = bookedSlots.includes(time);
                      const isSelected = selectedTime === time;
                      
                      return (
                        <button
                          key={time}
                          type="button"
                          disabled={isBooked}
                          onClick={() => setSelectedTime(time)}
                          className={cn(
                            "py-2 px-1 rounded-lg text-sm font-semibold transition-all border",
                            isBooked ? "bg-slate-100 text-slate-300 border-slate-100 cursor-not-allowed opacity-60" 
                            : isSelected ? "bg-indigo-600 text-white border-indigo-600 shadow-md"
                            : "bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:text-indigo-600"
                          )}
                        >
                          {time}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="mt-8 pt-6 border-t border-slate-100">
                  <button 
                    type="submit"
                    disabled={bookingLoading || !selectedTime}
                    className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bookingLoading ? "Confirming..." : selectedTime ? `Confirm ${selectedTime} Appointment` : "Select a time to confirm"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
