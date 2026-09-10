-- Enable UUID extension for unique identifiers
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. TABLES
-- ==========================================

-- PROFILES (Links to Supabase auth.users for staff/doctors)
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT NOT NULL,
    role TEXT CHECK (role IN ('doctor', 'nurse', 'admin')) DEFAULT 'doctor',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PATIENTS
CREATE TABLE public.patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mrn TEXT UNIQUE NOT NULL, -- Medical Record Number
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    gender TEXT CHECK (gender IN ('Male', 'Female', 'Other')),
    contact_number TEXT,
    medical_history TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- CLINICAL ENCOUNTERS / VISITS
CREATE TABLE public.encounters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
    provider_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    encounter_date TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    chief_complaint TEXT NOT NULL,
    clinical_notes TEXT,
    status TEXT CHECK (status IN ('scheduled', 'in-progress', 'completed', 'cancelled')) DEFAULT 'scheduled',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- LABORATORY RESULTS
CREATE TABLE public.lab_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    encounter_id UUID REFERENCES public.encounters(id) ON DELETE CASCADE NOT NULL,
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
    test_name TEXT NOT NULL,
    value NUMERIC NOT NULL,
    unit TEXT NOT NULL,
    reference_range TEXT,
    is_abnormal BOOLEAN DEFAULT FALSE,
    result_date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 2. INDEXES for Performance
-- ==========================================
CREATE INDEX idx_patients_mrn ON public.patients(mrn);
CREATE INDEX idx_patients_name ON public.patients(last_name, first_name);
CREATE INDEX idx_encounters_patient_id ON public.encounters(patient_id);
CREATE INDEX idx_encounters_provider_id ON public.encounters(provider_id);
CREATE INDEX idx_encounters_date ON public.encounters(encounter_date);
CREATE INDEX idx_lab_results_patient_id ON public.lab_results(patient_id);

-- ==========================================
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_results ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can read all profiles, but only update their own
CREATE POLICY "Allow authenticated read access to profiles" 
    ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow users to update own profile" 
    ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Patients: Authenticated clinical staff can read and write patient data
CREATE POLICY "Allow authenticated read access to patients" 
    ON public.patients FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert access to patients" 
    ON public.patients FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update access to patients" 
    ON public.patients FOR UPDATE TO authenticated USING (true);

-- Encounters: Authenticated clinical staff can manage encounters
CREATE POLICY "Allow authenticated read access to encounters" 
    ON public.encounters FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert access to encounters" 
    ON public.encounters FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update access to encounters" 
    ON public.encounters FOR UPDATE TO authenticated USING (true);

-- Lab Results: Authenticated clinical staff can manage labs
CREATE POLICY "Allow authenticated read access to lab_results" 
    ON public.lab_results FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert access to lab_results" 
    ON public.lab_results FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update access to lab_results" 
    ON public.lab_results FOR UPDATE TO authenticated USING (true);

-- ==========================================
-- 4. TRIGGERS
-- ==========================================

-- Function to automatically update the 'updated_at' timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_patients_modtime
    BEFORE UPDATE ON public.patients
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_encounters_modtime
    BEFORE UPDATE ON public.encounters
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Function to automatically create a profile record when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', 'doctor');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
