import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Activity, ShieldCheck, Calculator, AlertCircle, Trash2, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';

interface CalculationResult {
  status: 'safe' | 'warning' | 'danger';
  recommendedMg: number;
  maxMg: number;
  cartridges: number;
  warnings: string[];
}

const ANESTHETICS = [
  { id: 'lido_epi', name: 'Lidocaine 2% w/ Epi 1:100k', mgPerCartridge: 36, maxDoseMgKg: 7 },
  { id: 'arti_epi', name: 'Articaine 4% w/ Epi 1:100k', mgPerCartridge: 72, maxDoseMgKg: 7 },
  { id: 'mepi_plain', name: 'Mepivacaine 3% Plain', mgPerCartridge: 54, maxDoseMgKg: 6.6 },
  { id: 'prilo_plain', name: 'Prilocaine 4% Plain', mgPerCartridge: 72, maxDoseMgKg: 8 }
];

const CHRONIC_DISEASES = [
  { id: 'obesity', label: 'Obesity' },
  { id: 'diabetes', label: 'Diabetes' },
  { id: 'heart_disease', label: 'Heart Disease' },
  { id: 'hypertension', label: 'Hypertension' },
  { id: 'asthma', label: 'Asthma' },
  { id: 'renal', label: 'Renal Insufficiency' },
  { id: 'liver', label: 'Liver Disease' },
  { id: 'epilepsy', label: 'Epilepsy' }
];

export function AnestheticCalculator({ patientId }: { patientId: string }) {
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [bp, setBp] = useState('');
  const [isSmoker, setIsSmoker] = useState(false);
  const [selectedAnesthetic, setSelectedAnesthetic] = useState(ANESTHETICS[0].id);
  const [diseases, setDiseases] = useState<string[]>([]);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Load last calculation for this patient
  useEffect(() => {
    async function loadLastRec() {
      const { data } = await supabase
        .from('anesthetic_recommendations')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data && data.inputs) {
        const i = data.inputs;
        setAge(i.age || '');
        setWeight(i.weight || '');
        setBp(i.bp || '');
        setIsSmoker(i.isSmoker || false);
        setDiseases(i.diseases || []);
        setSelectedAnesthetic(i.selectedAnesthetic || ANESTHETICS[0].id);
        if (data.recommendation) {
          setResult(data.recommendation);
        }
      } else {
        // Reset if no data
        setAge(''); setWeight(''); setBp(''); setIsSmoker(false); setDiseases([]); setResult(null);
      }
    }
    loadLastRec();
  }, [patientId]);

  const toggleDisease = (id: string) => {
    setDiseases(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  };

  const calculate = async () => {
    const w = parseFloat(weight);
    const a = parseInt(age);
    const anesthetic = ANESTHETICS.find(an => an.id === selectedAnesthetic)!;
    
    const calculate = async () => {
      const w = parseFloat(weight);
      const a = parseInt(age);
      const anesthetic = ANESTHETICS.find(an => an.id === selectedAnesthetic)!;
      
      if (!w || !a) return;
    
      // --- هذا هو التعديل البسيط الذي يجب إضافته ---
      if (a <= 0 || w <= 0) {
        alert("Error: Age and Weight must be valid positive numbers.");
        return; // هذا الأمر يوقف تنفيذ الكود فوراً ولن يظهر أي نتيجة
      }
    }
    let warnings: string[] = [];
    let status: 'safe' | 'warning' | 'danger' = 'safe';

    // Clinical Logic
    let maxDose = w * anesthetic.maxDoseMgKg;
    
    // Adjustments
    if (a > 65) {
      maxDose *= 0.8;
      warnings.push("Geriatric Status: Dose reduced by 20%");
      status = 'warning';
    }
    
    if (diseases.includes('heart_disease')) {
      maxDose *= 0.7;
      warnings.push("Cardiac Condition: High restriction on vasopressors");
      status = 'danger';
    }

    if (diseases.includes('liver')) {
      maxDose *= 0.6;
      warnings.push("Hepatotoxicity Risk: Metabolism significantly slowed");
    }

    if (isSmoker) {
      maxDose *= 1.1;
      warnings.push("Smoker: Metabolic demand increased (+10% dose)");
      warnings.push("Smoker: Risk of delayed wound healing");
    }

    const systolic = parseInt(bp.split('/')[0]);
    if (systolic <=0) {
        alert("Error: Age and Weight must be valid positive numbers.");
        return; // هذا الأمر يوقف تنفيذ الكود فوراً ولن يظهر أي نتيجة
      }
    if (systolic > 160) {
      status = 'danger';
      warnings.push("Critical Hypertension: Avoid epinephrine");
    } else if (systolic > 140) {
      status = 'warning';
      warnings.push("Hypertension: Moderate epi restrictionRecommended");
    }

    const recommendedDose = maxDose * 0.7;
    const cartridges = Math.floor(recommendedDose / anesthetic.mgPerCartridge);

    const newResult: CalculationResult = {
      status: status === 'safe' ? 'safe' : 'danger', // Strictly Green or Red
      recommendedMg: Math.round(recommendedDose),
      maxMg: Math.round(maxDose),
      cartridges,
      warnings
    };

    setResult(newResult);
    
    // Save to Database
    setIsSaving(true);
    const inputs = { age, weight, bp, isSmoker, diseases, selectedAnesthetic };
    
    await supabase.from('anesthetic_recommendations').insert([{
      patient_id: patientId,
      inputs,
      recommendation: newResult
    }]);
    setIsSaving(false);
  };

  return (
    <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100 h-full flex flex-col">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-red-50 rounded-2xl text-red-600">
            <Calculator className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-black text-slate-900 tracking-tight">Clinical Dose Modeler</h3>
        </div>
        {isSaving && <span className="text-[10px] font-bold text-slate-400 animate-pulse uppercase tracking-widest">Saving Sync...</span>}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Age</label>
            <input
                type="number"
                min="0"
                onKeyDown={(e) => {
                  // منع كتابة إشارة الناقص '-' وحرف 'e' الخاص بالأرقام العلمية
                  if (e.key === '-' || e.key === 'e') e.preventDefault();
                }}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-bold text-slate-700"
                placeholder="35"
              />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Weight (kg)</label>
            <input
    type="number"
    min="0"
    onKeyDown={(e) => {
      // منع كتابة إشارة الناقص '-' وحرف 'e'
      if (e.key === '-' || e.key === 'e') e.preventDefault();
    }}
    value={weight}
    onChange={(e) => setWeight(e.target.value)}
    className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-bold text-slate-700"
    placeholder="75"
  />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Anesthetic Solution</label>
          <select
            value={selectedAnesthetic}
            onChange={(e) => setSelectedAnesthetic(e.target.value)}
            className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-bold text-slate-700"
          >
            {ANESTHETICS.map(an => (
              <option key={an.id} value={an.id}>{an.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Blood Pressure</label>
            <input
            type="number"
              min="0"
            onKeyDown={(e) => {
           // منع كتابة إشارة الناقص '-' وحرف 'e'
           if (e.key === '-' || e.key === 'e') e.preventDefault();
             }}
              value={bp}
              onChange={(e) => setBp(e.target.value)}
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-bold text-slate-700"
              placeholder="120/80"
            />
          </div>
          <div className="flex flex-col justify-end">
            <button 
              onClick={() => setIsSmoker(!isSmoker)}
              className={cn(
                "h-13.5 w-full rounded-2xl border transition-all flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest",
                isSmoker ? "bg-red-50 border-red-200 text-red-600" : "bg-slate-50 border-slate-200 text-slate-400"
              )}
            >
              Patient Smokes? {isSmoker ? "Yes" : "No"}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Systemic Considerations</label>
          <div className="grid grid-cols-2 gap-2">
            {CHRONIC_DISEASES.map(dis => (
              <button
                key={dis.id}
                onClick={() => toggleDisease(dis.id)}
                className={cn(
                  "px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-tight transition-all",
                  diseases.includes(dis.id) ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100" : "bg-white border-slate-100 text-slate-400 hover:border-slate-200"
                )}
              >
                {dis.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={calculate}
          className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-black transition-all shadow-xl"
        >
          Generate Safety Analysis
        </button>

        {result && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              "p-6 rounded-4xl border-2 shadow-inner",
              result.status === 'safe' ? "bg-emerald-50 border-emerald-100" : 
              result.status === 'warning' ? "bg-amber-50 border-amber-100" : "bg-red-50 border-red-100"
            )}
          >
            <div className="flex items-center justify-between mb-4">
               <div className="flex items-center gap-2">
                 <div className={cn(
                   "w-3 h-3 rounded-full animate-pulse",
                   result.status === 'safe' ? "bg-emerald-500" : 
                   result.status === 'warning' ? "bg-amber-500" : "bg-red-500"
                 )}></div>
                 <span className={cn(
                   "text-[10px] font-black uppercase tracking-widest",
                   result.status === 'safe' ? "text-emerald-700" : "text-red-700"
                 )}>
                   {result.status === 'safe' ? "Safe" : "Toxicity Warning"}
                 </span>
               </div>
               <ShieldCheck className={cn(
                 "w-5 h-5",
                 result.status === 'safe' ? "text-emerald-500" : "text-slate-300"
               )} />
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white/50 p-4 rounded-2xl border border-white/50">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Dose Target</p>
                <p className="text-xl font-black text-slate-900">{result.recommendedMg} mg</p>
              </div>
              <div className="bg-white/50 p-4 rounded-2xl border border-white/50">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Max Cartridges</p>
                <div className="flex items-end gap-1">
                   <p className="text-xl font-black text-slate-900">{result.cartridges}</p>
                   <p className="text-[10px] font-bold text-slate-400 mb-1">qty</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
               {result.warnings.map((w, i) => (
                 <div key={i} className="flex gap-2 items-start text-[10px] font-bold text-slate-600 bg-white/40 p-2 rounded-lg">
                   <div className="w-1 h-1 bg-slate-400 rounded-full mt-1.5"></div>
                   {w}
                 </div>
               ))}
            </div>
            
            
          </motion.div>
        )}
      </div>
    </div>
  );
}
