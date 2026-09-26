import React, { useState, useEffect } from 'react';
import { supabase, Profile, ProcedurePrice, Payment, MedicalRecord } from '../lib/supabase';
import { Wallet, Plus, Trash2, Save, History, Receipt, ArrowUpCircle, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

interface BillingSectionProps {
  patients: Profile[];
  selectedPatientId?: string;
}

export function BillingSection({ patients, selectedPatientId }: BillingSectionProps) {
  const [prices, setPrices] = useState<ProcedurePrice[]>([]);
  const [targetPatientId, setTargetPatientId] = useState<string>(selectedPatientId || '');
  const [patientRecord, setPatientRecord] = useState<MedicalRecord | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [newPaymentAmount, setNewPaymentAmount] = useState('');
  const [newPaymentNotes, setNewPaymentNotes] = useState('');
  const [isSavingPrice, setIsSavingPrice] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  useEffect(() => {
    fetchPrices();
    if (selectedPatientId) setTargetPatientId(selectedPatientId);
  }, [selectedPatientId]);

  useEffect(() => {
    if (targetPatientId) {
      fetchPatientBillingData(targetPatientId);
    }
  }, [targetPatientId]);

  const fetchPrices = async () => {
    const { data } = await supabase.from('procedure_prices').select('*');
    if (data) setPrices(data);
  };

  const fetchPatientBillingData = async (patientId: string) => {
    const { data: record } = await supabase
      .from('medical_records')
      .select('*')
      .eq('patient_id', patientId)
      .maybeSingle();
    
    setPatientRecord(record);

    const { data: payHistory } = await supabase
      .from('payments')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    
    setPayments(payHistory || []);
  };

  const updatePrice = async (name: string, price: number) => {
    setIsSavingPrice(true);
    await supabase.from('procedure_prices').upsert({ procedure_name: name, price_sp: price });
    await fetchPrices();
    setIsSavingPrice(false);
  };

  const addPayment = async () => {
    if (!targetPatientId || !newPaymentAmount) return;
    setIsProcessingPayment(true);
    
    const { error } = await supabase.from('payments').insert([{
      patient_id: targetPatientId,
      amount_sp: parseFloat(newPaymentAmount),
      notes: newPaymentNotes
    }]);

    if (!error) {
      setNewPaymentAmount('');
      setNewPaymentNotes('');
      fetchPatientBillingData(targetPatientId);
    }
    setIsProcessingPayment(false);
  };

  const calculateTotalCost = () => {
    if (!patientRecord) return 0;
    let total = 0;
    const status = patientRecord.teeth_status;
    
    Object.values(status).forEach(val => {
      const priceObj = prices.find(p => p.procedure_name === val);
      if (priceObj) total += priceObj.price_sp;
    });
    
    return total;
  };

  const totalCost = calculateTotalCost();
  const totalPaid = payments.reduce((sum, p) => sum + p.amount_sp, 0);
  const remaining = totalCost - totalPaid;

  return (
    <div className="space-y-8 pb-12">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Price Management */}
        <div className="lg:col-span-1 bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600">
              <Receipt className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight">Procedure Rates</h3>
          </div>
          
          <div className="space-y-4">
            {prices.map((p) => (
              <div key={p.procedure_name} className="flex items-center gap-4 group">
                <div className="flex-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{p.procedure_name.replace('_', ' ')}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      defaultValue={p.price_sp}
                      onBlur={(e) => updatePrice(p.procedure_name, parseInt(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 font-bold text-slate-700 outline-none focus:border-indigo-300 transition-all"
                    />
                    <span className="text-[10px] font-bold text-slate-400">S.P.</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Billing Management */}
        <div className="lg:col-span-2 bg-slate-900 p-10 rounded-[48px] text-white overflow-hidden relative">
          <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none">
             <Wallet className="w-64 h-64 -mr-20 -mt-20" />
          </div>

          <div className="relative z-10">
            <div className="flex items-center justify-between mb-10">
              <div>
                <select
                  value={targetPatientId}
                  onChange={(e) => setTargetPatientId(e.target.value)}
                  className="bg-white/10 border border-white/20 rounded-2xl px-6 py-3 text-lg font-bold outline-none focus:bg-white/20 transition-all appearance-none cursor-pointer"
                >
                  <option value="" className="text-slate-900">Select Patient to Bill...</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id} className="text-slate-900">{p.full_name}</option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50">Patient Ledger</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              <div className="bg-white/5 p-6 rounded-4xl border border-white/5">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2">Total Treatment</p>
                <p className="text-3xl font-black">{totalCost.toLocaleString()} <span className="text-sm font-medium opacity-50">S.P.</span></p>
              </div>
              <div className="bg-emerald-500/10 p-6 rounded-4xl border border-emerald-500/20">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2">Amount Paid</p>
                <p className="text-3xl font-black text-emerald-400">{totalPaid.toLocaleString()} <span className="text-sm font-medium opacity-50">S.P.</span></p>
              </div>
              <div className={remaining > 0 ? "bg-red-500/10 p-6 rounded-4xl border border-red-500/20" : "bg-blue-500/10 p-6 rounded-4xl border border-blue-500/20"}>
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2">Remaining</p>
                <p className="text-3xl font-black">{remaining.toLocaleString()} <span className="text-sm font-medium opacity-50">S.P.</span></p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Payment Form */}
              <div className="space-y-6">
                <h4 className="text-sm font-black uppercase tracking-widest text-white/50 pl-2">Record Payment</h4>
                <div className="space-y-4">
                   <div className="relative">
                      <input
                        type="number"
                        value={newPaymentAmount}
                        onChange={(e) => setNewPaymentAmount(e.target.value)}
                        placeholder="Amount in S.P."
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 font-bold text-white placeholder:text-white/20 outline-none focus:bg-white/10 transition-all"
                      />
                      <ArrowUpCircle className="absolute right-6 top-4 w-6 h-6 text-emerald-500" />
                   </div>
                   <textarea
                     value={newPaymentNotes}
                     onChange={(e) => setNewPaymentNotes(e.target.value)}
                     placeholder="Notes (Receipt num, method...)"
                     className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 font-bold text-white placeholder:text-white/20 outline-none focus:bg-white/10 transition-all h-24 resize-none"
                   />
                   <button
                     onClick={addPayment}
                     disabled={isProcessingPayment || !targetPatientId || !newPaymentAmount}
                     className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-900 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-xl shadow-emerald-500/20"
                   >
                     {isProcessingPayment ? "Recording..." : "Finalize Payment"}
                   </button>
                </div>
              </div>

              {/* Recent Transactions */}
              <div>
                <h4 className="text-sm font-black uppercase tracking-widest text-white/50 pl-2 mb-6">Payment History</h4>
                <div className="space-y-3 max-h-75 overflow-y-auto pr-4 custom-scrollbar">
                  {payments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-white/20">
                      <History className="w-12 h-12 mb-2" />
                      <p className="text-[10px] font-bold uppercase tracking-widest">No history yet</p>
                    </div>
                  ) : (
                    payments.map((p) => (
                      <div key={p.id} className="bg-white/5 p-4 rounded-2xl border border-white/5 flex items-center justify-between group hover:bg-white/10 transition-all">
                        <div>
                          <p className="text-sm font-black">+{p.amount_sp.toLocaleString()} S.P.</p>
                          <p className="text-[9px] font-bold text-white/40 uppercase tracking-widest">{format(new Date(p.created_at), 'dd MMM yyyy HH:mm')}</p>
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 transition-all">
                           <Trash2 className="w-4 h-4 text-white/20 hover:text-red-400 cursor-pointer" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
