// ============================================================================
// app.js — Core application controller
// Native ES6 module. Handles auth, state, CRUD, lab engine, AI extraction,
// dynamic DOM rendering, and theme switching.
// ============================================================================

import { supabase, TABLES } from './supabaseClient.js';

// ----------------------------------------------------------------------------
// DOM HELPERS
// ----------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const byId = (id) => document.getElementById(id);

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function calcAge(dob) {
  if (!dob) return null;
  const b = new Date(dob);
  if (Number.isNaN(b.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
}

function toLocalDatetimeInputValue(d) {
  const dt = d ? new Date(d) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// ----------------------------------------------------------------------------
// TOASTS & LOADER
// ----------------------------------------------------------------------------
function toast(message, type = 'info') {
  const container = byId('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

let loaderDepth = 0;
function showLoader(text = 'Working…') {
  loaderDepth++;
  byId('global-loader-text').textContent = text;
  byId('global-loader').classList.remove('hidden');
}
function hideLoader() {
  loaderDepth = Math.max(0, loaderDepth - 1);
  if (loaderDepth === 0) byId('global-loader').classList.add('hidden');
}
async function withLoader(text, fn) {
  showLoader(text);
  try { return await fn(); }
  finally { hideLoader(); }
}

// ----------------------------------------------------------------------------
// MODAL HELPERS
// ----------------------------------------------------------------------------
function openModal(id) { byId(id).classList.remove('hidden'); }
function closeModal(id) { byId(id).classList.add('hidden'); }

$$('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const backdrop = btn.closest('.modal-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
  });
});
$$('.modal-backdrop').forEach((backdrop) => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.add('hidden');
  });
});

function confirmAction(title, message) {
  return new Promise((resolve) => {
    byId('confirm-title').textContent = title;
    byId('confirm-message').textContent = message;
    openModal('modal-confirm');
    const okBtn = byId('confirm-ok-btn');
    const cancelBtn = byId('confirm-cancel-btn');
    const cleanup = () => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeModal('modal-confirm');
    };
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ----------------------------------------------------------------------------
// APPLICATION STATE
// ----------------------------------------------------------------------------
const state = {
  session: null,
  profile: null,           // row from profiles
  patients: [],
  currentPatientId: null,
  patientDetail: null,     // { patient, pmh, psh, medications, encounters (with orders), labResults }
  customLabs: [],
  globalLabs: [],
  doctors: [],              // admin only
  editing: {},              // scratch space for "currently editing id" per entity type
};

// ----------------------------------------------------------------------------
// THEME ENGINE
// ----------------------------------------------------------------------------
function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.classList.toggle('dark', mode === 'dark');
  localStorage.setItem('clinicchart:theme', mode);
  $$('.theme-btn, .theme-btn-lg').forEach((btn) => {
    btn.classList.toggle('theme-btn-active', btn.dataset.themeChoice === mode);
  });
}
function initTheme() {
  const saved = localStorage.getItem('clinicchart:theme') || 'light';
  applyTheme(saved);
}
$$('[data-theme-choice]').forEach((btn) => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.themeChoice));
});

// ----------------------------------------------------------------------------
// AUTH
// ----------------------------------------------------------------------------
let authMode = 'signin'; // 'signin' | 'signup'

byId('auth-toggle-mode').addEventListener('click', () => {
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  byId('auth-title').textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
  byId('auth-submit-btn').textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
  byId('auth-toggle-mode').textContent = authMode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in';
});

byId('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = byId('auth-email').value.trim();
  const password = byId('auth-password').value;
  const errEl = byId('auth-error');
  errEl.classList.add('hidden');
  byId('auth-submit-btn').disabled = true;
  try {
    if (authMode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      toast('Account created. If email confirmation is enabled, check your inbox.', 'success');
    }
  } catch (err) {
    errEl.textContent = err.message || 'Authentication failed.';
    errEl.classList.remove('hidden');
  } finally {
    byId('auth-submit-btn').disabled = false;
  }
});

byId('logout-btn').addEventListener('click', async () => {
  await supabase.auth.signOut();
});

supabase.auth.onAuthStateChange((_event, session) => {
  state.session = session;
  if (session) {
    bootAuthenticatedApp();
  } else {
    byId('auth-view').classList.remove('hidden');
    byId('app-shell').classList.add('hidden');
  }
});

async function bootAuthenticatedApp() {
  byId('auth-view').classList.add('hidden');
  byId('app-shell').classList.remove('hidden');
  await withLoader('Loading your workspace…', async () => {
    await loadProfile();
    await Promise.all([loadPatients(), loadCustomLabs(), loadGlobalLabs()]);
  });
  renderSidebarUser();
  renderPatientsTable();
  renderCustomLabsList();
  renderGlobalLabsList();
  switchView('patients');
}

async function loadProfile() {
  const uid = state.session.user.id;
  let { data, error } = await supabase.from(TABLES.PROFILES).select('*').eq('id', uid).maybeSingle();
  if (error) { toast(error.message, 'error'); return; }
  if (!data) {
    // Trigger may not have fired yet on very first sign-up; retry once shortly.
    await new Promise((r) => setTimeout(r, 800));
    ({ data } = await supabase.from(TABLES.PROFILES).select('*').eq('id', uid).maybeSingle());
  }
  state.profile = data;
  byId('nav-admin').classList.toggle('hidden', !(data && data.is_admin));
  byId('settings-full-name').value = data?.full_name || '';
  byId('settings-email').value = data?.email || '';
  byId('settings-gemini-key').value = data?.gemini_api_key || '';
}

function renderSidebarUser() {
  byId('sidebar-user-name').textContent = state.profile?.full_name || state.profile?.email || 'Doctor';
  byId('sidebar-user-role').textContent = state.profile?.is_admin ? 'Administrator' : 'Doctor';
}

// ----------------------------------------------------------------------------
// NAVIGATION
// ----------------------------------------------------------------------------
const viewTitles = { patients: 'Patients', labs: 'My Lab Library', admin: 'Admin', settings: 'Settings' };

function switchView(view) {
  $$('.view-section').forEach((s) => s.classList.add('hidden'));
  byId(`view-${view}`).classList.remove('hidden');
  byId('view-title').textContent = viewTitles[view] || '';
  $$('[data-nav]').forEach((btn) => btn.classList.toggle('nav-link-active', btn.dataset.nav === view));
  if (view === 'admin') loadDoctors().then(renderDoctorsList);
}
$$('[data-nav]').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.nav)));

byId('back-to-patients').addEventListener('click', () => {
  state.currentPatientId = null;
  switchView('patients');
});

// Patient detail tabs
$$('#patient-tabs [data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('#patient-tabs [data-tab]').forEach((b) => b.classList.remove('tab-btn-active'));
    btn.classList.add('tab-btn-active');
    $$('.tab-panel').forEach((p) => p.classList.add('hidden'));
    byId(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
});

// ----------------------------------------------------------------------------
// PATIENTS: LIST, SEARCH, CRUD
// ----------------------------------------------------------------------------
async function loadPatients() {
  const { data, error } = await supabase.from(TABLES.PATIENTS).select('*').order('full_name', { ascending: true });
  if (error) { toast(error.message, 'error'); return; }
  state.patients = data || [];
}

async function lastVisitDateFor(patientId) {
  const { data } = await supabase
    .from(TABLES.ENCOUNTERS)
    .select('encounter_date')
    .eq('patient_id', patientId)
    .order('encounter_date', { ascending: false })
    .limit(1);
  return data && data[0] ? data[0].encounter_date : null;
}

function filteredPatients() {
  const q = byId('patient-search').value.trim().toLowerCase();
  const statusFilter = byId('patient-status-filter').value;
  return state.patients.filter((p) => {
    if (statusFilter !== 'All' && p.status !== statusFilter) return false;
    if (!q) return true;
    const haystack = `${p.full_name} ${p.patient_code || ''}`.toLowerCase();
    return haystack.includes(q);
  });
}

function renderPatientsTable() {
  const rows = filteredPatients();
  const tbody = byId('patients-table-body');
  tbody.innerHTML = '';
  byId('patients-empty').classList.toggle('hidden', rows.length > 0);

  rows.forEach((p) => {
    const tr = document.createElement('tr');
    tr.className = 'cursor-pointer';
    const age = calcAge(p.date_of_birth);
    tr.innerHTML = `
      <td class="font-medium">${escapeHtml(p.full_name)}</td>
      <td>${p.patient_code_unavailable ? '<span class="text-slate-400 italic">Unavailable</span>' : escapeHtml(p.patient_code || '—')}</td>
      <td>${age !== null ? age + 'y' : '—'} / ${escapeHtml(p.sex || '—')}</td>
      <td>${p.phone_unavailable ? '<span class="text-slate-400 italic">Unavailable</span>' : escapeHtml(p.phone || '—')}</td>
      <td data-last-visit="${p.id}">…</td>
      <td><span class="badge ${p.status === 'Active' ? 'badge-active' : 'badge-archived'}">${p.status}</span></td>
      <td class="text-right">
        <button class="btn-ghost-sm" data-open-patient="${p.id}">Open chart</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  rows.forEach(async (p) => {
    const d = await lastVisitDateFor(p.id);
    const cell = tbody.querySelector(`[data-last-visit="${p.id}"]`);
    if (cell) cell.textContent = fmtDate(d);
  });

  $$('[data-open-patient]', tbody).forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openPatientDetail(btn.dataset.openPatient); });
  });
  $$('tr', tbody).forEach((tr, i) => {
    tr.addEventListener('click', () => { if (rows[i]) openPatientDetail(rows[i].id); });
  });
}

byId('patient-search').addEventListener('input', renderPatientsTable);
byId('patient-status-filter').addEventListener('change', renderPatientsTable);

byId('add-patient-btn').addEventListener('click', () => openPatientModal(null));

function openPatientModal(patient) {
  byId('modal-patient-title').textContent = patient ? 'Edit patient' : 'New patient';
  byId('patient-id').value = patient?.id || '';
  byId('patient-full-name').value = patient?.full_name || '';
  byId('patient-code').value = patient?.patient_code || '';
  byId('patient-code-unavailable').checked = !!patient?.patient_code_unavailable;
  byId('patient-phone').value = patient?.phone || '';
  byId('patient-phone-unavailable').checked = !!patient?.phone_unavailable;
  byId('patient-dob').value = patient?.date_of_birth || '';
  byId('patient-sex').value = patient?.sex || 'Unspecified';
  byId('patient-email').value = patient?.email || '';
  byId('patient-status').value = patient?.status || 'Active';
  byId('patient-address').value = patient?.address || '';
  byId('patient-notes').value = patient?.general_notes || '';
  openModal('modal-patient');
}

byId('patient-save-btn').addEventListener('click', async () => {
  const form = byId('patient-form');
  if (!form.reportValidity()) return;
  const id = byId('patient-id').value || undefined;
  const payload = {
    doctor_id: state.session.user.id,
    full_name: byId('patient-full-name').value.trim(),
    patient_code: byId('patient-code').value.trim() || null,
    patient_code_unavailable: byId('patient-code-unavailable').checked,
    phone: byId('patient-phone').value.trim() || null,
    phone_unavailable: byId('patient-phone-unavailable').checked,
    date_of_birth: byId('patient-dob').value || null,
    sex: byId('patient-sex').value,
    email: byId('patient-email').value.trim() || null,
    status: byId('patient-status').value,
    address: byId('patient-address').value.trim() || null,
    general_notes: byId('patient-notes').value.trim() || null,
  };
  await withLoader('Saving patient…', async () => {
    const q = id
      ? supabase.from(TABLES.PATIENTS).update(payload).eq('id', id)
      : supabase.from(TABLES.PATIENTS).insert(payload);
    const { error } = await q;
    if (error) { toast(error.message, 'error'); return; }
    toast('Patient saved.', 'success');
    closeModal('modal-patient');
    await loadPatients();
    renderPatientsTable();
    if (id && state.currentPatientId === id) await openPatientDetail(id);
  });
});

byId('edit-patient-btn').addEventListener('click', () => {
  const p = state.patientDetail?.patient;
  if (p) openPatientModal(p);
});

// ----------------------------------------------------------------------------
// PATIENT DETAIL / CHART
// ----------------------------------------------------------------------------
async function openPatientDetail(patientId) {
  state.currentPatientId = patientId;
  switchView('__patient_detail__'); // no-op guard, real switching below
  $$('.view-section').forEach((s) => s.classList.add('hidden'));
  byId('view-patient-detail').classList.remove('hidden');
  byId('view-title').textContent = 'Patient chart';

  await withLoader('Loading chart…', async () => {
    await loadPatientDetail(patientId);
  });
  renderPatientDetail();
}

async function loadPatientDetail(patientId) {
  const [{ data: patient }, { data: pmh }, { data: psh }, { data: medications }, { data: encounters }, { data: labResults }] =
    await Promise.all([
      supabase.from(TABLES.PATIENTS).select('*').eq('id', patientId).maybeSingle(),
      supabase.from(TABLES.PMH).select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from(TABLES.PSH).select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from(TABLES.MEDICATIONS).select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from(TABLES.ENCOUNTERS).select('*').eq('patient_id', patientId).order('encounter_date', { ascending: false }),
      supabase.from(TABLES.LAB_RESULTS).select('*').eq('patient_id', patientId).order('result_date', { ascending: true }),
    ]);

  let orders = [];
  if (encounters && encounters.length) {
    const { data: ordersData } = await supabase
      .from(TABLES.ORDERS)
      .select('*')
      .in('encounter_id', encounters.map((e) => e.id));
    orders = ordersData || [];
  }

  state.patientDetail = {
    patient,
    pmh: pmh || [],
    psh: psh || [],
    medications: medications || [],
    encounters: (encounters || []).map((e) => ({ ...e, orders: orders.filter((o) => o.encounter_id === e.id) })),
    labResults: labResults || [],
  };
}

function renderPatientDetail() {
  const d = state.patientDetail;
  if (!d || !d.patient) return;
  const p = d.patient;
  const age = calcAge(p.date_of_birth);
  byId('pd-name').textContent = p.full_name;
  byId('pd-subline').textContent = [
    age !== null ? `${age} yrs` : null,
    p.sex,
    p.patient_code_unavailable ? 'ID unavailable' : (p.patient_code ? `ID: ${p.patient_code}` : null),
    p.phone_unavailable ? 'Phone unavailable' : (p.phone || null),
  ].filter(Boolean).join(' · ');
  const badge = byId('pd-status-badge');
  badge.textContent = p.status;
  badge.className = `badge ${p.status === 'Active' ? 'badge-active' : 'badge-archived'}`;

  renderTimeline();
  renderPmh();
  renderPsh();
  renderMedications();
  renderLabsTrend();
}

// ---- Timeline (encounters) ----
function renderTimeline() {
  const list = byId('encounters-list');
  const encounters = state.patientDetail.encounters;
  list.innerHTML = '';
  byId('encounters-empty').classList.toggle('hidden', encounters.length > 0);

  encounters.forEach((enc) => {
    const card = document.createElement('div');
    card.className = 'card p-5';
    const ordersHtml = enc.orders.length
      ? `<ul class="mt-2 space-y-1">${enc.orders.map((o) => `<li class="text-xs text-slate-500 dark:text-slate-400">• <span class="font-medium capitalize">${escapeHtml(o.order_type)}</span>: ${escapeHtml(o.description)}${o.follow_up_date ? ` (follow-up ${fmtDate(o.follow_up_date)})` : ''}</li>`).join('')}</ul>`
      : '';
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3 mb-3">
        <div>
          <p class="text-sm font-semibold">${fmtDateTime(enc.encounter_date)}</p>
        </div>
        <button class="btn-ghost-sm" data-edit-encounter="${enc.id}">Edit</button>
      </div>
      <div class="grid sm:grid-cols-2 gap-3 text-sm">
        <div><p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">CC</p><p>${escapeHtml(enc.chief_complaint) || '—'}</p></div>
        <div><p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">HPI</p><p>${escapeHtml(enc.hpi) || '—'}</p></div>
        <div><p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">PE</p><p>${escapeHtml(enc.physical_exam) || '—'}</p></div>
        <div><p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">A&amp;P</p><p>${escapeHtml(enc.assessment_plan) || '—'}</p></div>
      </div>
      ${ordersHtml}
    `;
    list.appendChild(card);
  });

  $$('[data-edit-encounter]', list).forEach((btn) => {
    btn.addEventListener('click', () => openEncounterModal(encounters.find((e) => e.id === btn.dataset.editEncounter)));
  });
}

byId('new-encounter-btn').addEventListener('click', () => openEncounterModal(null));

let currentOrderRows = [];
function openEncounterModal(enc) {
  state.editing.encounter = enc?.id || null;
  byId('encounter-id').value = enc?.id || '';
  byId('encounter-date').value = toLocalDatetimeInputValue(enc?.encounter_date);
  byId('encounter-cc').value = enc?.chief_complaint || '';
  byId('encounter-hpi').value = enc?.hpi || '';
  byId('encounter-pe').value = enc?.physical_exam || '';
  byId('encounter-ap').value = enc?.assessment_plan || '';
  currentOrderRows = enc?.orders ? enc.orders.map((o) => ({ ...o })) : [];
  renderOrderRows();
  $('[data-delete-target="encounter"]').classList.toggle('hidden', !enc);
  openModal('modal-encounter');
}

function renderOrderRows() {
  const wrap = byId('encounter-orders-rows');
  wrap.innerHTML = '';
  currentOrderRows.forEach((row, idx) => {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2';
    div.innerHTML = `
      <select class="form-input w-32" data-order-type="${idx}">
        <option value="medication" ${row.order_type === 'medication' ? 'selected' : ''}>Medication</option>
        <option value="diagnostic" ${row.order_type === 'diagnostic' ? 'selected' : ''}>Diagnostic</option>
        <option value="followup" ${row.order_type === 'followup' ? 'selected' : ''}>Follow-up</option>
      </select>
      <input class="form-input flex-1" placeholder="Description" value="${escapeHtml(row.description || '')}" data-order-desc="${idx}" />
      <input type="date" class="form-input w-40 ${row.order_type === 'followup' ? '' : 'invisible'}" value="${row.follow_up_date || ''}" data-order-date="${idx}" />
      <button type="button" class="text-slate-400 hover:text-red-500" data-order-remove="${idx}">&times;</button>
    `;
    wrap.appendChild(div);
  });

  $$('[data-order-type]', wrap).forEach((sel) => sel.addEventListener('change', (e) => {
    const idx = Number(e.target.dataset.orderType);
    currentOrderRows[idx].order_type = e.target.value;
    renderOrderRows();
  }));
  $$('[data-order-desc]', wrap).forEach((inp) => inp.addEventListener('input', (e) => {
    currentOrderRows[Number(e.target.dataset.orderDesc)].description = e.target.value;
  }));
  $$('[data-order-date]', wrap).forEach((inp) => inp.addEventListener('input', (e) => {
    currentOrderRows[Number(e.target.dataset.orderDate)].follow_up_date = e.target.value;
  }));
  $$('[data-order-remove]', wrap).forEach((btn) => btn.addEventListener('click', () => {
    currentOrderRows.splice(Number(btn.dataset.orderRemove), 1);
    renderOrderRows();
  }));
}

byId('add-order-row-btn').addEventListener('click', () => {
  currentOrderRows.push({ order_type: 'medication', description: '', follow_up_date: null });
  renderOrderRows();
});

byId('encounter-save-btn').addEventListener('click', async () => {
  const id = byId('encounter-id').value || undefined;
  const payload = {
    patient_id: state.currentPatientId,
    doctor_id: state.session.user.id,
    encounter_date: new Date(byId('encounter-date').value).toISOString(),
    chief_complaint: byId('encounter-cc').value.trim() || null,
    hpi: byId('encounter-hpi').value.trim() || null,
    physical_exam: byId('encounter-pe').value.trim() || null,
    assessment_plan: byId('encounter-ap').value.trim() || null,
  };
  await withLoader('Saving encounter…', async () => {
    let encounterId = id;
    if (id) {
      const { error } = await supabase.from(TABLES.ENCOUNTERS).update(payload).eq('id', id);
      if (error) { toast(error.message, 'error'); return; }
      await supabase.from(TABLES.ORDERS).delete().eq('encounter_id', id);
    } else {
      const { data, error } = await supabase.from(TABLES.ENCOUNTERS).insert(payload).select().single();
      if (error) { toast(error.message, 'error'); return; }
      encounterId = data.id;
    }
    const ordersToInsert = currentOrderRows
      .filter((o) => o.description && o.description.trim())
      .map((o) => ({
        encounter_id: encounterId,
        doctor_id: state.session.user.id,
        order_type: o.order_type,
        description: o.description.trim(),
        follow_up_date: o.order_type === 'followup' ? (o.follow_up_date || null) : null,
      }));
    if (ordersToInsert.length) {
      const { error: ordersErr } = await supabase.from(TABLES.ORDERS).insert(ordersToInsert);
      if (ordersErr) toast(ordersErr.message, 'error');
    }
    toast('Encounter saved.', 'success');
    closeModal('modal-encounter');
    await loadPatientDetail(state.currentPatientId);
    renderPatientDetail();
  });
});

$('[data-delete-target="encounter"]').addEventListener('click', async () => {
  const id = byId('encounter-id').value;
  if (!id) return;
  const ok = await confirmAction('Delete encounter?', 'This will permanently remove this encounter and its orders.');
  if (!ok) return;
  await withLoader('Deleting…', async () => {
    const { error } = await supabase.from(TABLES.ENCOUNTERS).delete().eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Encounter deleted.', 'success');
    closeModal('modal-encounter');
    await loadPatientDetail(state.currentPatientId);
    renderPatientDetail();
  });
});

// ---- PMH ----
function renderPmh() {
  const list = byId('pmh-list');
  const items = state.patientDetail.pmh;
  list.innerHTML = '';
  byId('pmh-empty').classList.toggle('hidden', items.length > 0);
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'py-2 flex items-center justify-between gap-3';
    row.innerHTML = `
      <div>
        <p class="text-sm font-medium">${escapeHtml(item.condition_name)}</p>
        <p class="text-xs text-slate-400">${item.duration_value ? `${item.duration_value} ${item.duration_unit || ''}` : ''} ${item.notes ? '· ' + escapeHtml(item.notes) : ''}</p>
      </div>
      <button class="btn-ghost-sm" data-edit-pmh="${item.id}">Edit</button>
    `;
    list.appendChild(row);
  });
  $$('[data-edit-pmh]', list).forEach((btn) => btn.addEventListener('click', () => openPmhModal(items.find((i) => i.id === btn.dataset.editPmh))));
}

$('[data-add="pmh"]').addEventListener('click', () => openPmhModal(null));

function openPmhModal(item) {
  byId('pmh-id').value = item?.id || '';
  byId('pmh-condition').value = item?.condition_name || '';
  byId('pmh-duration-value').value = item?.duration_value ?? '';
  byId('pmh-duration-unit').value = item?.duration_unit || 'years';
  byId('pmh-notes').value = item?.notes || '';
  $('[data-delete-target="pmh"]').classList.toggle('hidden', !item);
  openModal('modal-pmh');
}

byId('pmh-save-btn').addEventListener('click', async () => {
  const form = byId('pmh-form');
  if (!form.reportValidity()) return;
  const id = byId('pmh-id').value || undefined;
  const payload = {
    patient_id: state.currentPatientId,
    condition_name: byId('pmh-condition').value.trim(),
    duration_value: byId('pmh-duration-value').value ? Number(byId('pmh-duration-value').value) : null,
    duration_unit: byId('pmh-duration-unit').value,
    notes: byId('pmh-notes').value.trim() || null,
  };
  await withLoader('Saving…', async () => {
    const q = id ? supabase.from(TABLES.PMH).update(payload).eq('id', id) : supabase.from(TABLES.PMH).insert(payload);
    const { error } = await q;
    if (error) { toast(error.message, 'error'); return; }
    toast('Saved.', 'success');
    closeModal('modal-pmh');
    await loadPatientDetail(state.currentPatientId);
    renderPatientDetail();
  });
});

$('[data-delete-target="pmh"]').addEventListener('click', async () => {
  const id = byId('pmh-id').value;
  if (!id || !(await confirmAction('Delete condition?', 'This cannot be undone.'))) return;
  await withLoader('Deleting…', async () => {
    const { error } = await supabase.from(TABLES.PMH).delete().eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
    closeModal('modal-pmh');
    await loadPatientDetail(state.currentPatientId);
    renderPatientDetail();
  });
});

// ---- PSH ----
function renderPsh() {
  const list = byId('psh-list');
  const items = state.patientDetail.psh;
  list.innerHTML = '';
  byId('psh-empty').classList.toggle('hidden', items.length > 0);
  items.forEach((item) => {
    const dateStr = item.procedure_date ? fmtDate(item.procedure_date) : (item.procedure_year || '—');
    const row = document.createElement('div');
    row.className = 'py-2 flex items-center justify-between gap-3';
    row.innerHTML = `
      <div>
        <p class="text-sm font-medium">${escapeHtml(item.procedure_name)}</p>
        <p class="text-xs text-slate-400">${dateStr}${item.facility_location ? ' · ' + escapeHtml(item.facility_location) : ''}</p>
      </div>
      <button class="btn-ghost-sm" data-edit-psh="${item.id}">Edit</button>
    `;
    list.appendChild(row);
  });
  $$('[data-edit-psh]', list).forEach((btn) => btn.addEventListener('click', () => openPshModal(items.find((i) => i.id === btn.dataset.editPsh))));
}

$('[data-add="psh"]').addEventListener('click', () => openPshModal(null));

function openPshModal(item) {
  byId('psh-id').value = item?.id || '';
  byId('psh-procedure-name').value = item?.procedure_name || '';
  byId('psh-facility').value = item?.facility_location || '';
  byId('psh-date').value = item?.procedure_date || '';
  byId('psh-year').value = item?.procedure_year ?? '';
  byId('psh-notes').value = item?.notes || '';
  $('[data-delete-target="psh"]').classList.toggle('hidden', !item);
  openModal('modal-psh');
}

byId('psh-save-btn').addEventListener('click', async () => {
  const form = byId('psh-form');
  if (!form.reportValidity()) return;
  const id = byId('psh-id').value || undefined;
  const payload = {
    patient_id: state.currentPatientId,
    procedure_name: byId('psh-procedure-name').value.trim(),
    facility_location: byId('psh-facility').value.trim() || null,
    procedure_date: byId('psh-date').value || null,
    procedure_year: byId('psh-year').value ? Number(byId('psh-year').value) : null,
    notes: byId('psh-notes').value.trim() || null,
  };
  await withLoader('Saving…', async () => {
    const q = id ? supabase.from(TABLES.PSH).update(payload).eq('id', id) : supabase.from(TABLES.PSH).insert(payload);
    const { error } = await q;
    if (error) { toast(error.message, 'error'); return; }
    toast('Saved.', 'success');
    closeModal('modal-psh');
    await loadPatientDetail(state.currentPatientId);
    renderPatientDetail();
  });
});

$('[data-delete-target="psh"]').addEventListener('click', async () => {
  const id = byId('psh-id').value;
  if (!id || !(await confirmAction('Delete surgery record?', 'This cannot be undone.'))) return;
  await withLoader('Deleting…', async () => {
    const { error } = await supabase.from(TABLES.PSH).delete().eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
    closeModal('modal-psh');
    await loadPatientDetail(state.currentPatientId);
    renderPatientDetail();
  });
});

// ---- Medications ----
function renderMedications() {
  const list = byId('medications-list');
  const items = state.patientDetail.medications;
  list.innerHTML = '';
  byId('medications-empty').classList.toggle('hidden', items.length > 0);
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'py-2 flex items-center justify-between gap-3';
    row.innerHTML = `
      <div>
        <p class="text-sm font-medium">${escapeHtml(item.drug_name)} <span class="badge ${item.status === 'Active' ? 'badge-active' : 'badge-archived'} ml-1">${item.status}</span></p>
        <p class="text-xs text-slate-400">${[item.dosage, item.route, item.frequency].filter(Boolean).map(escapeHtml).join(' · ') || '—'}</p>
      </div>
      <button class="btn-ghost-sm" data-edit-med="${item.id}">Edit</button>
    `;
    list.appendChild(row);
  });
  $$('[data-edit-med]', list).forEach((btn) => btn.addEventListener('click', () => openMedicationModal(items.find((i) => i.id === btn.dataset.editMed))));
}

$('[data-add="medication"]').addEventListener('click', () => openMedicationModal(null));

function openMedicationModal(item) {
  byId('medication-id').value = item?.id || '';
  byId('medication-drug-name').value = item?.drug_name || '';
  byId('medication-dosage').value = item?.dosage || '';
  byId('medication-route').value = item?.route || '';
  byId('medication-frequency').value = item?.frequency || '';
  byId('medication-start-date').value = item?.start_date || '';
  byId('medication-start-unspecified').checked = !!item?.start_date_unspecified;
  byId('medication-status').value = item?.status || 'Active';
  byId('medication-stop-date').value = item?.stop_date || '';
  byId('medication-notes').value = item?.notes || '';
  toggleMedicationStopDate();
  $('[data-delete-target="medication"]').classList.toggle('hidden', !item);
  openModal('modal-medication');
}

function toggleMedicationStopDate() {
  byId('medication-stop-date-wrap').classList.toggle('hidden', byId('medication-status').value !== 'Stopped');
}
byId('medication-status').addEventListener('change', toggleMedicationStopDate);

byId('medication-save-btn').addEventListener('click', async () => {
  const form = byId('medication-form');
  if (!form.reportValidity()) return;
  const id = byId('medication-id').value || undefined;
  const payload = {
    patient_id: state.currentPatientId,
    drug_name: byId('medication-drug-name').value.trim(),
    dosage: byId('medication-dosage').value.trim() || null,
    route: byId('medication-route').value.trim() || null,
    frequency: byId('medication-frequency').value.trim() || null,
    start_date: byId('medication-start-unspecified').checked ? null : (byId('medication-start-date').value || null),
    start_date_unspecified: byId('medication-start-unspecified').checked,
    status: byId('medication-status').value,
    stop_date: byId('medication-status').value === 'Stopped' ? (byId('medication-stop-date').value || null) : null,
    notes: byId('medication-notes').value.trim() || null,
  };
  await withLoader('Saving…', async () => {
    const q = id ? supabase.from(TABLES.MEDICATIONS).update(payload).eq('id', id) : supabase.from(TABLES.MEDICATIONS).insert(payload);
    const { error } = await q;
    if (error) { toast(error.message, 'error'); return; }
    toast('Saved.', 'success');
    closeModal('modal-medication');
    await loadPatientDetail(state.currentPatientId);
    renderPatientDetail();
  });
});

$('[data-delete-target="medication"]').addEventListener('click', async () => {
  const id = byId('medication-id').value;
  if (!id || !(await confirmAction('Delete medication?', 'This cannot be undone.'))) return;
  await withLoader('Deleting…', async () => {
    const { error } = await supabase.from(TABLES.MEDICATIONS).delete().eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
    closeModal('modal-medication');
    await loadPatientDetail(state.currentPatientId);
    renderPatientDetail();
  });
});

// ----------------------------------------------------------------------------
// LAB DEFINITIONS: custom (per-doctor) + global (admin-managed, read-all)
// ----------------------------------------------------------------------------
async function loadCustomLabs() {
  const { data, error } = await supabase.from(TABLES.CUSTOM_LABS).select('*').order('name');
  if (error) { toast(error.message, 'error'); return; }
  state.customLabs = data || [];
}
async function loadGlobalLabs() {
  const { data, error } = await supabase.from(TABLES.GLOBAL_LABS).select('*').order('name');
  if (error) { toast(error.message, 'error'); return; }
  state.globalLabs = data || [];
}

function renderCustomLabsList() {
  const list = byId('custom-labs-list');
  list.innerHTML = '';
  byId('custom-labs-empty').classList.toggle('hidden', state.customLabs.length > 0);
  state.customLabs.forEach((lab) => {
    const row = document.createElement('div');
    row.className = 'py-2 flex items-center justify-between gap-3';
    row.innerHTML = `
      <div>
        <p class="text-sm font-medium">${escapeHtml(lab.name)} <span class="text-xs text-slate-400">${escapeHtml(lab.unit || '')}</span></p>
        <p class="text-xs text-slate-400">Range: ${lab.lower_limit ?? '—'} – ${lab.upper_limit ?? '—'}</p>
      </div>
      <button class="btn-ghost-sm" data-edit-custom-lab="${lab.id}">Edit</button>
    `;
    list.appendChild(row);
  });
  $$('[data-edit-custom-lab]', list).forEach((btn) => btn.addEventListener('click', () =>
    openLabDefModal('custom', state.customLabs.find((l) => l.id === btn.dataset.editCustomLab))));
}

function renderGlobalLabsList() {
  const list = byId('global-labs-list');
  list.innerHTML = '';
  byId('global-labs-empty').classList.toggle('hidden', state.globalLabs.length > 0);
  state.globalLabs.forEach((lab) => {
    const row = document.createElement('div');
    row.className = 'py-2';
    row.innerHTML = `
      <p class="text-sm font-medium">${escapeHtml(lab.name)} <span class="text-xs text-slate-400">${escapeHtml(lab.unit || '')}</span></p>
      <p class="text-xs text-slate-400">Range: ${lab.lower_limit ?? '—'} – ${lab.upper_limit ?? '—'}</p>
    `;
    list.appendChild(row);
  });
}

function renderAdminGlobalLabsList() {
  const list = byId('admin-global-labs-list');
  if (!list) return;
  list.innerHTML = '';
  state.globalLabs.forEach((lab) => {
    const row = document.createElement('div');
    row.className = 'py-2 flex items-center justify-between gap-3';
    row.innerHTML = `
      <div>
        <p class="text-sm font-medium">${escapeHtml(lab.name)} <span class="text-xs text-slate-400">${escapeHtml(lab.unit || '')}</span></p>
        <p class="text-xs text-slate-400">Range: ${lab.lower_limit ?? '—'} – ${lab.upper_limit ?? '—'}</p>
      </div>
      <button class="btn-ghost-sm" data-edit-global-lab="${lab.id}">Edit</button>
    `;
    list.appendChild(row);
  });
  $$('[data-edit-global-lab]', list).forEach((btn) => btn.addEventListener('click', () =>
    openLabDefModal('global', state.globalLabs.find((l) => l.id === btn.dataset.editGlobalLab))));
}

byId('add-custom-lab-btn').addEventListener('click', () => openLabDefModal('custom', null));
byId('admin-add-global-lab-btn').addEventListener('click', () => openLabDefModal('global', null));

function openLabDefModal(scope, lab) {
  byId('modal-lab-def-title').textContent = `${scope === 'custom' ? 'Custom' : 'Global'} lab ${lab ? '(edit)' : ''}`;
  byId('lab-def-scope').value = scope;
  byId('lab-def-id').value = lab?.id || '';
  byId('lab-def-name').value = lab?.name || '';
  byId('lab-def-unit').value = lab?.unit || '';
  byId('lab-def-lower').value = lab?.lower_limit ?? '';
  byId('lab-def-upper').value = lab?.upper_limit ?? '';
  $('[data-delete-target="lab-def"]').classList.toggle('hidden', !lab);
  openModal('modal-lab-def');
}

byId('lab-def-save-btn').addEventListener('click', async () => {
  const form = byId('lab-def-form');
  if (!form.reportValidity()) return;
  const scope = byId('lab-def-scope').value;
  const id = byId('lab-def-id').value || undefined;
  const table = scope === 'custom' ? TABLES.CUSTOM_LABS : TABLES.GLOBAL_LABS;
  const payload = {
    name: byId('lab-def-name').value.trim(),
    unit: byId('lab-def-unit').value.trim() || null,
    lower_limit: byId('lab-def-lower').value !== '' ? Number(byId('lab-def-lower').value) : null,
    upper_limit: byId('lab-def-upper').value !== '' ? Number(byId('lab-def-upper').value) : null,
  };
  if (scope === 'custom') payload.doctor_id = state.session.user.id;
  else payload.created_by = state.session.user.id;

  await withLoader('Saving lab…', async () => {
    const q = id ? supabase.from(table).update(payload).eq('id', id) : supabase.from(table).insert(payload);
    const { error } = await q;
    if (error) { toast(error.message, 'error'); return; }
    toast('Lab saved.', 'success');
    closeModal('modal-lab-def');
    if (scope === 'custom') { await loadCustomLabs(); renderCustomLabsList(); }
    else { await loadGlobalLabs(); renderGlobalLabsList(); renderAdminGlobalLabsList(); }
  });
});

$('[data-delete-target="lab-def"]').addEventListener('click', async () => {
  const scope = byId('lab-def-scope').value;
  const id = byId('lab-def-id').value;
  if (!id || !(await confirmAction('Delete lab definition?', 'Existing recorded results keep their own snapshot values and will not be affected.'))) return;
  const table = scope === 'custom' ? TABLES.CUSTOM_LABS : TABLES.GLOBAL_LABS;
  await withLoader('Deleting…', async () => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
    closeModal('modal-lab-def');
    if (scope === 'custom') { await loadCustomLabs(); renderCustomLabsList(); }
    else { await loadGlobalLabs(); renderGlobalLabsList(); renderAdminGlobalLabsList(); }
  });
});

// ---- Bulk import (Admin, Excel/CSV -> global_labs) ----
byId('bulk-import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await withLoader('Importing labs…', async () => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
      const payloads = [];
      for (const row of rows) {
        if (!row || !row[0]) continue;
        const name = String(row[0]).trim();
        if (!name || name.toLowerCase() === 'lab test name') continue; // skip header row if present
        payloads.push({
          name,
          unit: row[1] !== undefined && row[1] !== null ? String(row[1]).trim() : null,
          lower_limit: row[2] !== undefined && row[2] !== '' ? Number(row[2]) : null,
          upper_limit: row[3] !== undefined && row[3] !== '' ? Number(row[3]) : null,
          created_by: state.session.user.id,
        });
      }
      if (!payloads.length) { toast('No valid rows found in file.', 'error'); return; }
      // Non-destructive merge: upsert by unique name, never touches doctor_custom_labs.
      const { error } = await supabase.from(TABLES.GLOBAL_LABS).upsert(payloads, { onConflict: 'name' });
      if (error) { toast(error.message, 'error'); return; }
      toast(`Imported ${payloads.length} global lab(s).`, 'success');
      await loadGlobalLabs();
      renderGlobalLabsList();
      renderAdminGlobalLabsList();
    } catch (err) {
      toast('Could not parse file: ' + err.message, 'error');
    } finally {
      e.target.value = '';
    }
  });
});

// ----------------------------------------------------------------------------
// LAB RESULTS: add + longitudinal trend table with out-of-bound flagging
// ----------------------------------------------------------------------------
function allAvailableLabs() {
  // Custom labs take precedence in listing; both are shown, clearly scoped.
  return [
    ...state.customLabs.map((l) => ({ ...l, source: 'custom' })),
    ...state.globalLabs.map((l) => ({ ...l, source: 'global' })),
  ];
}

function classifyResult(value, lower, upper) {
  if (lower === null || lower === undefined || upper === null || upper === undefined || value === null) return 'normal';
  if (value < lower || value > upper) return 'out-of-bound';
  const range = upper - lower;
  if (range > 0) {
    const bufferPct = 0.1;
    const buffer = range * bufferPct;
    if (value <= lower + buffer || value >= upper - buffer) return 'borderline';
  }
  return 'normal';
}

function renderLabsTrend() {
  const results = state.patientDetail.labResults;
  const head = byId('labs-trend-head');
  const body = byId('labs-trend-body');
  byId('labs-empty').classList.toggle('hidden', results.length > 0);
  head.innerHTML = '<th class="sticky left-0 bg-inherit">Parameter</th>';
  body.innerHTML = '';
  if (!results.length) return;

  const dates = [...new Set(results.map((r) => r.result_date))].sort();
  dates.forEach((d) => {
    const th = document.createElement('th');
    th.textContent = fmtDate(d);
    head.appendChild(th);
  });

  const paramNames = [...new Set(results.map((r) => r.lab_name_snapshot))];
  paramNames.forEach((name) => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.className = 'sticky left-0 bg-white dark:bg-slate-900 font-medium';
    tdName.textContent = name;
    tr.appendChild(tdName);

    dates.forEach((d) => {
      const match = results.find((r) => r.lab_name_snapshot === name && r.result_date === d);
      const td = document.createElement('td');
      if (match) {
        const cls = classifyResult(match.value, match.lower_limit_snapshot, match.upper_limit_snapshot);
        const badgeClass = cls === 'out-of-bound' ? 'badge-out-of-bound' : cls === 'borderline' ? 'badge-borderline' : 'badge-normal';
        td.innerHTML = `<span class="badge ${badgeClass}">${match.value}${match.unit_snapshot ? ' ' + escapeHtml(match.unit_snapshot) : ''}</span>`;
        td.title = `Reference: ${match.lower_limit_snapshot ?? '—'}–${match.upper_limit_snapshot ?? '—'}`;
      } else {
        td.textContent = '—';
        td.className = 'text-slate-300 dark:text-slate-700';
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

byId('add-lab-result-btn').addEventListener('click', () => {
  const select = byId('lab-result-lab-select');
  select.innerHTML = allAvailableLabs().map((l) =>
    `<option value="${l.source}:${l.id}">${escapeHtml(l.name)} (${l.source === 'custom' ? 'my lab' : 'global'})</option>`
  ).join('');
  byId('lab-result-value').value = '';
  byId('lab-result-date').value = new Date().toISOString().slice(0, 10);
  updateLabResultReference();
  openModal('modal-lab-result');
});
byId('lab-result-lab-select').addEventListener('change', updateLabResultReference);

function updateLabResultReference() {
  const [source, id] = byId('lab-result-lab-select').value.split(':');
  const lab = allAvailableLabs().find((l) => l.source === source && l.id === id);
  byId('lab-result-reference').textContent = lab
    ? `Reference range: ${lab.lower_limit ?? '—'} – ${lab.upper_limit ?? '—'} ${lab.unit || ''}`
    : '';
}

byId('lab-result-save-btn').addEventListener('click', async () => {
  const form = byId('lab-result-form');
  if (!form.reportValidity()) return;
  const [source, id] = byId('lab-result-lab-select').value.split(':');
  const lab = allAvailableLabs().find((l) => l.source === source && l.id === id);
  if (!lab) return;
  const payload = {
    patient_id: state.currentPatientId,
    doctor_id: state.session.user.id,
    lab_source: source,
    global_lab_id: source === 'global' ? lab.id : null,
    custom_lab_id: source === 'custom' ? lab.id : null,
    lab_name_snapshot: lab.name,
    unit_snapshot: lab.unit || null,
    lower_limit_snapshot: lab.lower_limit ?? null,
    upper_limit_snapshot: lab.upper_limit ?? null,
    value: Number(byId('lab-result-value').value),
    result_date: byId('lab-result-date').value || new Date().toISOString().slice(0, 10),
    source_method: 'manual',
  };
  await withLoader('Saving result…', async () => {
    const { error } = await supabase.from(TABLES.LAB_RESULTS).insert(payload);
    if (error) { toast(error.message, 'error'); return; }
    toast('Lab result saved.', 'success');
    closeModal('modal-lab-result');
    await loadPatientDetail(state.currentPatientId);
    renderPatientDetail();
  });
});

// ----------------------------------------------------------------------------
// AI-POWERED LAB EXTRACTION (Gemini 2.0 Flash)
// ----------------------------------------------------------------------------
const LAB_ALIASES = {
  'ast': ['ast', 'sgot', 'ast/sgot', 'aspartate aminotransferase'],
  'alt': ['alt', 'sgpt', 'alt/sgpt', 'alanine aminotransferase'],
  'hemoglobin': ['hemoglobin', 'hgb', 'hb'],
  'hematocrit': ['hematocrit', 'hct'],
  'creatinine': ['creatinine', 'cr'],
  'glucose': ['glucose', 'blood sugar', 'fbs', 'rbs'],
  'wbc': ['wbc', 'white blood cell', 'white blood cells', 'leukocytes'],
  'platelets': ['platelets', 'plt'],
  'tsh': ['tsh', 'thyroid stimulating hormone'],
  'ldl': ['ldl', 'ldl cholesterol', 'low density lipoprotein'],
  'hdl': ['hdl', 'hdl cholesterol', 'high density lipoprotein'],
  'triglycerides': ['triglycerides', 'tg'],
};

function normalizeLabName(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9/ ]/g, '');
}

function findBestLabMatch(extractedName) {
  const norm = normalizeLabName(extractedName);
  const available = allAvailableLabs();

  // 1. Exact (normalized) name match
  let match = available.find((l) => normalizeLabName(l.name) === norm);
  if (match) return match;

  // 2. Alias table match
  for (const [canonical, aliases] of Object.entries(LAB_ALIASES)) {
    if (aliases.some((a) => norm.includes(a) || a.includes(norm))) {
      match = available.find((l) => normalizeLabName(l.name).includes(canonical) || aliases.some((a) => normalizeLabName(l.name).includes(a)));
      if (match) return match;
    }
  }

  // 3. Fuzzy substring match
  match = available.find((l) => normalizeLabName(l.name).includes(norm) || norm.includes(normalizeLabName(l.name)));
  return match || null;
}

byId('ai-extract-btn').addEventListener('click', () => {
  byId('ai-extract-no-key').classList.toggle('hidden', !!state.profile?.gemini_api_key);
  byId('ai-extract-file').value = '';
  byId('ai-extract-results').classList.add('hidden');
  byId('ai-extract-save-btn').classList.add('hidden');
  openModal('modal-ai-extract');
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let lastExtraction = [];

byId('ai-extract-run-btn').addEventListener('click', async () => {
  const file = byId('ai-extract-file').files[0];
  const apiKey = state.profile?.gemini_api_key;
  if (!apiKey) { toast('Add a Gemini API key in Settings first.', 'error'); return; }
  if (!file) { toast('Choose a file to extract from.', 'error'); return; }

  await withLoader('Extracting lab values with Gemini…', async () => {
    try {
      let extracted = [];
      if (file.type === 'application/vnd.ms-excel' || file.type.includes('sheet') || /\.(xlsx|xls|csv)$/i.test(file.name)) {
        // Excel/CSV files: parse locally with SheetJS, then let Gemini normalize (text-only prompt).
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const csvText = XLSX.utils.sheet_to_csv(sheet);
        extracted = await callGeminiTextExtraction(apiKey, csvText);
      } else {
        // PDF / image: send as base64 inlineData directly to Gemini.
        const base64 = await fileToBase64(file);
        extracted = await callGeminiFileExtraction(apiKey, base64, file.type || 'application/pdf');
      }
      lastExtraction = extracted;
      renderExtractionReview(extracted);
    } catch (err) {
      toast('Extraction failed: ' + err.message, 'error');
    }
  });
});

async function callGeminiFileExtraction(apiKey, base64Data, mimeType) {
  const prompt = `You are a clinical lab report parser. Extract every lab test result from this document.
Return ONLY a JSON array (no markdown, no prose) where each element is:
{"name": "<test name as printed>", "value": <numeric value>, "unit": "<unit or empty string>"}
Only include rows that have a numeric result value. Do not include reference ranges as separate entries.`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64Data } },
        ],
      }],
    }),
  });
  return parseGeminiJsonResponse(res);
}

async function callGeminiTextExtraction(apiKey, csvText) {
  const prompt = `You are a clinical lab report parser. The following is raw spreadsheet content from a lab report:
---
${csvText}
---
Extract every lab test result. Return ONLY a JSON array (no markdown, no prose) where each element is:
{"name": "<test name>", "value": <numeric value>, "unit": "<unit or empty string>"}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  return parseGeminiJsonResponse(res);
}

async function parseGeminiJsonResponse(res) {
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Gemini API error (${res.status}): ${errBody.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) parsed = JSON.parse(arrMatch[0]);
    else throw new Error('Could not parse a JSON array from the AI response.');
  }
  if (!Array.isArray(parsed)) throw new Error('Unexpected AI response shape.');
  return parsed.filter((r) => r && r.name && r.value !== undefined && r.value !== null && !Number.isNaN(Number(r.value)));
}

function renderExtractionReview(rows) {
  const tbody = byId('ai-extract-rows');
  tbody.innerHTML = '';
  if (!rows.length) {
    toast('No lab values were found in this file.', 'error');
    byId('ai-extract-results').classList.add('hidden');
    byId('ai-extract-save-btn').classList.add('hidden');
    return;
  }
  rows.forEach((r, idx) => {
    const match = findBestLabMatch(r.name);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" data-extract-include="${idx}" ${match ? 'checked' : ''} /></td>
      <td>${escapeHtml(r.name)}</td>
      <td>${match ? `<span class="badge badge-active">${escapeHtml(match.name)}</span>` : '<span class="text-xs text-amber-600">No match — will be skipped</span>'}</td>
      <td>${escapeHtml(String(r.value))}</td>
      <td>${escapeHtml(r.unit || match?.unit || '')}</td>
    `;
    tbody.appendChild(tr);
  });
  byId('ai-extract-results').classList.remove('hidden');
  byId('ai-extract-save-btn').classList.remove('hidden');
}

byId('ai-extract-save-btn').addEventListener('click', async () => {
  const checks = $$('[data-extract-include]', byId('ai-extract-rows'));
  const toSave = [];
  checks.forEach((chk, idx) => {
    if (!chk.checked) return;
    const r = lastExtraction[idx];
    const match = findBestLabMatch(r.name);
    if (!match) return;
    toSave.push({
      patient_id: state.currentPatientId,
      doctor_id: state.session.user.id,
      lab_source: match.source,
      global_lab_id: match.source === 'global' ? match.id : null,
      custom_lab_id: match.source === 'custom' ? match.id : null,
      lab_name_snapshot: match.name,
      unit_snapshot: r.unit || match.unit || null,
      lower_limit_snapshot: match.lower_limit ?? null,
      upper_limit_snapshot: match.upper_limit ?? null,
      value: Number(r.value),
      result_date: new Date().toISOString().slice(0, 10),
      source_method: 'ai_extracted',
    });
  });
  if (!toSave.length) { toast('No matched rows selected.', 'error'); return; }
  await withLoader('Saving extracted results…', async () => {
    const { error } = await supabase.from(TABLES.LAB_RESULTS).insert(toSave);
    if (error) { toast(error.message, 'error'); return; }
    toast(`Saved ${toSave.length} lab result(s).`, 'success');
    closeModal('modal-ai-extract');
    await loadPatientDetail(state.currentPatientId);
    renderPatientDetail();
  });
});

// ----------------------------------------------------------------------------
// ADMIN: doctor accounts
// ----------------------------------------------------------------------------
async function loadDoctors() {
  if (!state.profile?.is_admin) return;
  const { data, error } = await supabase.from(TABLES.PROFILES).select('*').order('full_name');
  if (error) { toast(error.message, 'error'); return; }
  state.doctors = data || [];
}

function renderDoctorsList() {
  const list = byId('doctors-list');
  list.innerHTML = '';
  state.doctors.forEach((doc) => {
    const row = document.createElement('div');
    row.className = 'py-2 flex items-center justify-between gap-3';
    row.innerHTML = `
      <div>
        <p class="text-sm font-medium">${escapeHtml(doc.full_name || doc.email)} ${doc.is_admin ? '<span class="badge badge-active ml-1">Admin</span>' : ''}</p>
        <p class="text-xs text-slate-400">${escapeHtml(doc.email)} · ${doc.is_active ? 'Active' : 'Deactivated'}</p>
      </div>
      <button class="btn-ghost-sm" data-toggle-active="${doc.id}">${doc.is_active ? 'Deactivate' : 'Activate'}</button>
    `;
    list.appendChild(row);
  });
  $$('[data-toggle-active]', list).forEach((btn) => btn.addEventListener('click', async () => {
    const doc = state.doctors.find((d) => d.id === btn.dataset.toggleActive);
    await withLoader('Updating…', async () => {
      const { error } = await supabase.from(TABLES.PROFILES).update({ is_active: !doc.is_active }).eq('id', doc.id);
      if (error) { toast(error.message, 'error'); return; }
      await loadDoctors();
      renderDoctorsList();
    });
  }));
  renderAdminGlobalLabsList();
}

byId('add-doctor-btn').addEventListener('click', () => openModal('modal-doctor'));

// ----------------------------------------------------------------------------
// SETTINGS
// ----------------------------------------------------------------------------
byId('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await withLoader('Saving profile…', async () => {
    const { error } = await supabase.from(TABLES.PROFILES)
      .update({ full_name: byId('settings-full-name').value.trim() })
      .eq('id', state.session.user.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Profile saved.', 'success');
    await loadProfile();
    renderSidebarUser();
  });
});

byId('gemini-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await withLoader('Saving API key…', async () => {
    const { error } = await supabase.from(TABLES.PROFILES)
      .update({ gemini_api_key: byId('settings-gemini-key').value.trim() || null })
      .eq('id', state.session.user.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Gemini API key saved.', 'success');
    await loadProfile();
  });
});

// ----------------------------------------------------------------------------
// INIT
// ----------------------------------------------------------------------------
(async function init() {
  initTheme();
  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;
  if (session) {
    bootAuthenticatedApp();
  } else {
    byId('auth-view').classList.remove('hidden');
  }
})();
