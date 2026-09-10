// ============================================================================
// supabaseClient.js
// Native ESM Supabase client setup. Imported by app.js as:
//   import { supabase } from './supabaseClient.js';
// ============================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// --------------------------------------------------------------------------
// REQUIRED: replace these two placeholders with your project's values.
// Project Settings > API in the Supabase dashboard.
// --------------------------------------------------------------------------
const SUPABASE_URL = 'https://yqczkujzbfhbkxtjdlfp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxY3prdWp6YmZoYmt4dGpkbGZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMTY3OTEsImV4cCI6MjEwNDU5Mjc5MX0.KNTdgzLiiB7HIwrrJNY0ZNqoQXZ7eilYxW7imhYyz8s';

if (SUPABASE_URL.includes('YOUR_SUPABASE_URL_HERE') || SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY_HERE')) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabaseClient] Supabase credentials are still placeholders. ' +
    'Edit supabaseClient.js and set SUPABASE_URL / SUPABASE_ANON_KEY before using the app.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Convenience: table name constants, kept in one place so app.js never
// hardcodes strings that could drift from schema.sql.
export const TABLES = {
  PROFILES: 'profiles',
  PATIENTS: 'patients',
  PMH: 'patient_pmh',
  PSH: 'patient_psh',
  MEDICATIONS: 'patient_medications',
  ENCOUNTERS: 'encounters',
  ORDERS: 'encounter_orders',
  GLOBAL_LABS: 'global_labs',
  CUSTOM_LABS: 'doctor_custom_labs',
  LAB_RESULTS: 'lab_results',
};
