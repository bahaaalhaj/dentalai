-- 1. إنشاء الجداول (Profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  role TEXT DEFAULT 'patient' CHECK (role IN ('patient', 'doctor')),
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- دالة التعامل مع المستخدمين الجدد
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, phone)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name', 
    COALESCE(new.raw_user_meta_data->>'role', 'patient'),
    new.raw_user_meta_data->>'phone'
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger (إصلاح وتجديد)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. جدول المواعيد (Appointments)
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  time TIME NOT NULL,
  status TEXT DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'completed')),
  confirmation_status TEXT DEFAULT 'pending' CHECK (confirmation_status IN ('pending', 'confirmed')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 3. جدول السجل الطبي (Medical Records) - الحل النهائي لمشكلة الحفظ
DROP TABLE IF EXISTS public.medical_records CASCADE; -- سنعيده نظيفاً مع الـ UNIQUE
CREATE TABLE public.medical_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  medical_history TEXT,
  teeth_status JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 4. الجداول الإضافية (X-Ray & Anesthetic)
CREATE TABLE IF NOT EXISTS public.xray_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  ai_report JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.anesthetic_recommendations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  inputs JSONB,
  recommendation JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- ==========================================
-- نظام الحماية (RLS) والقوانين
-- ==========================================

-- دالة فحص الدكتور
CREATE OR REPLACE FUNCTION public.is_doctor()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'doctor');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- تفعيل الحماية
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;

-- تنظيف السياسات القديمة
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Doctors can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Patients view own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Doctors view all appointments" ON public.appointments;
DROP POLICY IF EXISTS "Anyone can view appts for availability" ON public.appointments;
DROP POLICY IF EXISTS "Patients insert own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Patients delete own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Patients view own records" ON public.medical_records;
DROP POLICY IF EXISTS "Doctors manage all records" ON public.medical_records;

-- تطبيق القوانين الجديدة (تزامن المواعيد والنصيحة)
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Doctors can view all profiles" ON public.profiles FOR SELECT USING (public.is_doctor());

CREATE POLICY "Anyone can view appts for availability" ON public.appointments FOR SELECT USING (true);
CREATE POLICY "Patients insert own appointments" ON public.appointments FOR INSERT WITH CHECK (patient_id = auth.uid());
CREATE POLICY "Patients delete own appointments" ON public.appointments FOR DELETE USING (patient_id = auth.uid());
CREATE POLICY "Doctors view all appointments" ON public.appointments FOR ALL USING (public.is_doctor());

CREATE POLICY "Patients view own records" ON public.medical_records FOR SELECT USING (patient_id = auth.uid());
CREATE POLICY "Doctors manage all records" ON public.medical_records FOR ALL USING (public.is_doctor());

-- RLS for X-Ray table
ALTER TABLE public.xray_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors manage all xrays" ON public.xray_images FOR ALL USING (public.is_doctor());
CREATE POLICY "Patients view own xrays" ON public.xray_images FOR SELECT USING (patient_id = auth.uid());

-- RLS for Anesthetics
ALTER TABLE public.anesthetic_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors manage all anesthetic recs" ON public.anesthetic_recommendations FOR ALL USING (public.is_doctor());
-- Note: Patients CANNOT see these recs (they are internal)
-- So no patient select policy

-- Storage policies
CREATE POLICY "Public Read Access" ON storage.objects FOR SELECT USING (bucket_id = 'xrays');
CREATE POLICY "Doctors can upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'xrays' AND (SELECT public.is_doctor()));

-- تفعيل ميزة التحديث اللحظي (Real-time) بأمان
DO $$
BEGIN
  -- Storage Bucket for X-rays (Safe creation)
  INSERT INTO storage.buckets (id, name, public) 
  VALUES ('xrays', 'xrays', true)
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'appointments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'medical_records') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.medical_records;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'profiles') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'xray_images') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.xray_images;
  END IF;
END $$;
-- Procedure Prices table
CREATE TABLE IF NOT EXISTS public.procedure_prices (
    procedure_name TEXT PRIMARY KEY,
    price_sp NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Payments table
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES public.profiles(id),
    amount_sp NUMERIC NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.procedure_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Doctors manage prices" ON public.procedure_prices FOR ALL USING (public.is_doctor());
CREATE POLICY "Public read prices" ON public.procedure_prices FOR SELECT USING (true);

CREATE POLICY "Doctors manage payments" ON public.payments FOR ALL USING (public.is_doctor());
CREATE POLICY "Patients view own payments" ON public.payments FOR SELECT USING (patient_id = auth.uid());

-- Add to Realtime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'procedure_prices') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.procedure_prices;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'payments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;
END $$;

-- Initialize default prices if empty
INSERT INTO public.procedure_prices (procedure_name, price_sp)
VALUES 
  ('cavity', 50000),
  ('filling', 150000),
  ('extracted', 100000),
  ('root_canal', 450000),
  ('crown', 800000),
  ('implant', 1200000)
ON CONFLICT (procedure_name) DO NOTHING;