import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://rzxktvccqggkjnpbqrhn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6eGt0dmNjcWdna2pucGJxcmhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMzA5MDcsImV4cCI6MjEwNDYwNjkwN30.jEq3PkN_EO0yyre8lLi1fwBiadI-4b4AjAhKqlLpoVY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
