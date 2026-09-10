-- ============================================================================
-- CLINICAL MANAGEMENT APPLICATION — SUPABASE SCHEMA
-- ============================================================================
-- Run this entire file once in the Supabase SQL Editor (Project > SQL Editor)
-- on a fresh project. It is idempotent-ish (uses IF NOT EXISTS / DROP ... IF
-- EXISTS where sensible) so it can be re-run during development.
--
-- Execution order matters: extensions -> tables -> functions -> triggers ->
-- indexes -> RLS enablement -> RLS policies. Do not reorder sections.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- 1. PROFILES (doctor accounts, 1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null default '',
  email           text not null,
  is_admin        boolean not null default false,
  is_active       boolean not null default true,
  gemini_api_key  text, -- doctor's own Google Gemini API key, used client-side only
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.profiles is 'Doctor accounts. One row per auth.users row. is_admin=true designates the practice administrator.';

-- ----------------------------------------------------------------------------
-- 2. PATIENTS
-- ----------------------------------------------------------------------------
create table if not exists public.patients (
  id                    uuid primary key default gen_random_uuid(),
  doctor_id             uuid not null references public.profiles(id) on delete cascade,
  full_name             text not null,
  patient_code          text,             -- "Patient ID" — free text/MRN
  patient_code_unavailable boolean not null default false,
  date_of_birth         date,
  sex                   text check (sex in ('Male','Female','Other','Unspecified')) default 'Unspecified',
  phone                 text,
  phone_unavailable     boolean not null default false,
  email                 text,
  address               text,
  status                text not null check (status in ('Active','Archived')) default 'Active',
  general_notes         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.patients is 'Patient registry, strictly owned by one doctor (doctor_id).';

-- ----------------------------------------------------------------------------
-- 3. PAST MEDICAL HISTORY (PMH)
-- ----------------------------------------------------------------------------
create table if not exists public.patient_pmh (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  condition_name  text not null,
  duration_value  numeric,
  duration_unit   text check (duration_unit in ('months','years')),
  notes           text,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. PAST SURGICAL HISTORY (PSH)
-- ----------------------------------------------------------------------------
create table if not exists public.patient_psh (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null references public.patients(id) on delete cascade,
  procedure_name     text not null,
  facility_location  text, -- optional
  procedure_date     date,        -- specific date, if known
  procedure_year     integer,     -- year only, if that's all that's known
  notes              text,
  created_at         timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 5. MEDICATIONS (active & past)
-- ----------------------------------------------------------------------------
create table if not exists public.patient_medications (
  id                      uuid primary key default gen_random_uuid(),
  patient_id              uuid not null references public.patients(id) on delete cascade,
  drug_name               text not null,
  dosage                  text,
  route                   text,
  frequency               text,
  start_date              date,
  start_date_unspecified  boolean not null default false,
  status                  text not null check (status in ('Active','Stopped')) default 'Active',
  stop_date               date,
  notes                   text,
  created_at              timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 6. CLINICAL ENCOUNTERS (SOAP notes)
-- ----------------------------------------------------------------------------
create table if not exists public.encounters (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references public.patients(id) on delete cascade,
  doctor_id           uuid not null references public.profiles(id) on delete cascade,
  encounter_date      timestamptz not null default now(),
  chief_complaint     text, -- CC
  hpi                 text, -- History of Present Illness
  physical_exam       text, -- PE
  assessment_plan     text, -- A&P
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 7. ENCOUNTER ORDERS (treatment/diagnostic/follow-up logging)
-- ----------------------------------------------------------------------------
create table if not exists public.encounter_orders (
  id               uuid primary key default gen_random_uuid(),
  encounter_id     uuid not null references public.encounters(id) on delete cascade,
  doctor_id        uuid not null references public.profiles(id) on delete cascade,
  order_type       text not null check (order_type in ('medication','diagnostic','followup')),
  description      text not null,
  follow_up_date   date, -- used when order_type = 'followup'
  created_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 8. GLOBAL LAB LIBRARY (admin-managed, globally readable)
-- ----------------------------------------------------------------------------
create table if not exists public.global_labs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  unit          text,
  lower_limit   numeric,
  upper_limit   numeric,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (name)
);

comment on table public.global_labs is 'Admin-curated standard lab definitions, readable by every doctor. Never overwrites doctor_custom_labs.';

-- ----------------------------------------------------------------------------
-- 9. DOCTOR CUSTOM LABS (private per-doctor lab definitions)
-- ----------------------------------------------------------------------------
create table if not exists public.doctor_custom_labs (
  id            uuid primary key default gen_random_uuid(),
  doctor_id     uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  unit          text,
  lower_limit   numeric,
  upper_limit   numeric,
  created_at    timestamptz not null default now(),
  unique (doctor_id, name)
);

-- ----------------------------------------------------------------------------
-- 10. LAB RESULTS (values recorded per encounter/patient)
-- ----------------------------------------------------------------------------
-- Snapshots of name/unit/limits are stored alongside the value so that a
-- later edit to a lab definition does not rewrite historical trend data.
create table if not exists public.lab_results (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null references public.patients(id) on delete cascade,
  encounter_id       uuid references public.encounters(id) on delete set null,
  doctor_id          uuid not null references public.profiles(id) on delete cascade,
  lab_source         text not null check (lab_source in ('global','custom')),
  global_lab_id      uuid references public.global_labs(id) on delete set null,
  custom_lab_id      uuid references public.doctor_custom_labs(id) on delete set null,
  lab_name_snapshot  text not null,
  unit_snapshot      text,
  lower_limit_snapshot numeric,
  upper_limit_snapshot numeric,
  value              numeric not null,
  result_date        date not null default current_date,
  source_method      text not null default 'manual' check (source_method in ('manual','ai_extracted')),
  created_at         timestamptz not null default now(),
  constraint lab_results_source_ref_chk check (
    (lab_source = 'global' and global_lab_id is not null and custom_lab_id is null) or
    (lab_source = 'custom' and custom_lab_id is not null and global_lab_id is null)
  )
);

-- ----------------------------------------------------------------------------
-- 11. HELPER FUNCTIONS
-- ----------------------------------------------------------------------------

-- Returns true if the given user id belongs to an admin doctor.
-- SECURITY DEFINER + fixed search_path avoids RLS recursion on profiles.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = uid), false);
$$;

-- Auto-creates a profile row whenever a new auth.users row is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'is_admin')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Generic updated_at bumper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();

drop trigger if exists trg_patients_updated_at on public.patients;
create trigger trg_patients_updated_at before update on public.patients
  for each row execute procedure public.set_updated_at();

drop trigger if exists trg_encounters_updated_at on public.encounters;
create trigger trg_encounters_updated_at before update on public.encounters
  for each row execute procedure public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 12. PERFORMANCE INDEXES
-- ----------------------------------------------------------------------------
create index if not exists idx_patients_doctor_id on public.patients(doctor_id);
create index if not exists idx_patients_status on public.patients(doctor_id, status);
create index if not exists idx_patients_full_name on public.patients using gin (to_tsvector('simple', full_name));

create index if not exists idx_pmh_patient_id on public.patient_pmh(patient_id);
create index if not exists idx_psh_patient_id on public.patient_psh(patient_id);
create index if not exists idx_meds_patient_id on public.patient_medications(patient_id);
create index if not exists idx_meds_status on public.patient_medications(patient_id, status);

create index if not exists idx_encounters_patient_id on public.encounters(patient_id, encounter_date desc);
create index if not exists idx_encounters_doctor_id on public.encounters(doctor_id);

create index if not exists idx_orders_encounter_id on public.encounter_orders(encounter_id);
create index if not exists idx_orders_doctor_id on public.encounter_orders(doctor_id);

create index if not exists idx_custom_labs_doctor_id on public.doctor_custom_labs(doctor_id);

create index if not exists idx_lab_results_patient_id on public.lab_results(patient_id, result_date desc);
create index if not exists idx_lab_results_encounter_id on public.lab_results(encounter_id);
create index if not exists idx_lab_results_doctor_id on public.lab_results(doctor_id);

-- ----------------------------------------------------------------------------
-- 13. ENABLE ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.patients            enable row level security;
alter table public.patient_pmh         enable row level security;
alter table public.patient_psh         enable row level security;
alter table public.patient_medications enable row level security;
alter table public.encounters          enable row level security;
alter table public.encounter_orders    enable row level security;
alter table public.global_labs         enable row level security;
alter table public.doctor_custom_labs  enable row level security;
alter table public.lab_results         enable row level security;

-- ----------------------------------------------------------------------------
-- 14. RLS POLICIES
-- ----------------------------------------------------------------------------

-- ---- profiles ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid() or public.is_admin(auth.uid()))
  with check (id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

-- Note: creating NEW doctor accounts (new auth.users rows) must be done via
-- Supabase Admin API / Dashboard with the service role key (see instructions.md).
-- The anon/client key can never create other users' auth accounts directly.

-- ---- patients ----
drop policy if exists patients_all on public.patients;
create policy patients_all on public.patients
  for all using (doctor_id = auth.uid()) with check (doctor_id = auth.uid());

-- ---- patient_pmh (owned via parent patient) ----
drop policy if exists pmh_all on public.patient_pmh;
create policy pmh_all on public.patient_pmh
  for all using (
    exists (select 1 from public.patients p where p.id = patient_id and p.doctor_id = auth.uid())
  ) with check (
    exists (select 1 from public.patients p where p.id = patient_id and p.doctor_id = auth.uid())
  );

-- ---- patient_psh ----
drop policy if exists psh_all on public.patient_psh;
create policy psh_all on public.patient_psh
  for all using (
    exists (select 1 from public.patients p where p.id = patient_id and p.doctor_id = auth.uid())
  ) with check (
    exists (select 1 from public.patients p where p.id = patient_id and p.doctor_id = auth.uid())
  );

-- ---- patient_medications ----
drop policy if exists meds_all on public.patient_medications;
create policy meds_all on public.patient_medications
  for all using (
    exists (select 1 from public.patients p where p.id = patient_id and p.doctor_id = auth.uid())
  ) with check (
    exists (select 1 from public.patients p where p.id = patient_id and p.doctor_id = auth.uid())
  );

-- ---- encounters ----
drop policy if exists encounters_all on public.encounters;
create policy encounters_all on public.encounters
  for all using (doctor_id = auth.uid()) with check (doctor_id = auth.uid());

-- ---- encounter_orders ----
drop policy if exists orders_all on public.encounter_orders;
create policy orders_all on public.encounter_orders
  for all using (doctor_id = auth.uid()) with check (doctor_id = auth.uid());

-- ---- global_labs: readable by every authenticated doctor, writable by admin only ----
drop policy if exists global_labs_select on public.global_labs;
create policy global_labs_select on public.global_labs
  for select using (auth.role() = 'authenticated');

drop policy if exists global_labs_write on public.global_labs;
create policy global_labs_write on public.global_labs
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ---- doctor_custom_labs: strictly private per doctor ----
drop policy if exists custom_labs_all on public.doctor_custom_labs;
create policy custom_labs_all on public.doctor_custom_labs
  for all using (doctor_id = auth.uid()) with check (doctor_id = auth.uid());

-- ---- lab_results ----
drop policy if exists lab_results_all on public.lab_results;
create policy lab_results_all on public.lab_results
  for all using (doctor_id = auth.uid()) with check (doctor_id = auth.uid());

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
