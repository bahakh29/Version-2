import { supabase } from './supabaseClient.js';

// ==========================================
// STATE MANAGEMENT
// ==========================================
let currentUser = null;
let currentProfile = null;
let isSignUpMode = false;
let patientsData = [];
let encountersData = [];
let labsData = [];

// ==========================================
// INITIALIZATION & AUTH LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    initLucideIcons();
    setupEventListeners();
    await checkAuthSession();
});

function initLucideIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

async function checkAuthSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        showToast(error.message, 'error');
        showAuthScreen();
        return;
    }

    if (session) {
        currentUser = session.user;
        await fetchUserProfile();
        showWorkspace();
    } else {
        showAuthScreen();
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            currentUser = session.user;
            await fetchUserProfile();
            showWorkspace();
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            currentProfile = null;
            showAuthScreen();
        }
    });
}

// ==========================================
// TOAST NOTIFICATION SYSTEM
// ==========================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;

    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'error') iconName = 'alert-circle';

    toast.innerHTML = `
        <i data-lucide="${iconName}" class="w-5 h-5 shrink-0"></i>
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);
    initLucideIcons();

    setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
}

// ==========================================
// AUTHENTICATION LOGIC
// ==========================================
async function fetchUserProfile() {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching profile:', error);
        }

        currentProfile = data || {
            full_name: currentUser.user_metadata?.full_name || currentUser.email.split('@')[0],
            role: 'doctor'
        };

        updateUserUI();
    } catch (err) {
        console.error('Profile fetch failed:', err);
    }
}

function updateUserUI() {
    const nameEl = document.getElementById('user-display-name');
    const roleEl = document.getElementById('user-role-badge');
    const avatarEl = document.getElementById('user-avatar');

    if (nameEl) nameEl.textContent = currentProfile.full_name || 'Provider';
    if (roleEl) roleEl.textContent = currentProfile.role || 'Doctor';
    if (avatarEl && currentProfile.full_name) {
        const initials = currentProfile.full_name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
        avatarEl.textContent = initials || 'DR';
    }
}

function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-workspace').classList.add('hidden');
}

function showWorkspace() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-workspace').classList.remove('hidden');
    loadDashboardData();
}

// ==========================================
// EVENT LISTENERS & ROUTING
// ==========================================
function setupEventListeners() {
    // Auth Form Toggle & Submit
    const authForm = document.getElementById('auth-form');
    const toggleAuthBtn = document.getElementById('btn-toggle-auth-mode');
    
    toggleAuthBtn.addEventListener('click', () => {
        isSignUpMode = !isSignUpMode;
        const fullnameField = document.getElementById('fullname-field');
        const submitBtnText = document.querySelector('#btn-auth-submit span');
        const titleEl = document.querySelector('#auth-title-container h2');
        const subTitleEl = document.querySelector('#auth-title-container p');

        if (isSignUpMode) {
            fullnameField.classList.remove('hidden');
            submitBtnText.textContent = 'Create Provider Account';
            titleEl.textContent = 'Register Provider';
            subTitleEl.textContent = 'Join the MediPulse clinical platform';
            toggleAuthBtn.textContent = 'Already registered? Sign in instead';
        } else {
            fullnameField.classList.add('hidden');
            submitBtnText.textContent = 'Authenticate';
            titleEl.textContent = 'Clinical Sign In';
            subTitleEl.textContent = 'Access your secure provider workspace';
            toggleAuthBtn.textContent = 'Need a provider account? Register here';
        }
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        const fullName = document.getElementById('auth-fullname').value;

        const btn = document.getElementById('btn-auth-submit');
        btn.disabled = true;
        btn.style.opacity = '0.7';

        try {
            if (isSignUpMode) {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: { data: { full_name: fullName } }
                });
                if (error) throw error;
                showToast('Account created successfully! You may now sign in.', 'success');
                toggleAuthBtn.click();
            } else {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                showToast('Welcome back, Doctor.', 'success');
            }
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', async () => {
        await supabase.auth.signOut();
        showToast('Signed out of clinical workspace', 'info');
    });

    // Navigation Tabs
    const navItems = document.querySelectorAll('#sidebar-nav .nav-item, .nav-link');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetView = item.getAttribute('data-target');
            if (targetView) switchView(targetView);
        });
    });

    // Mobile Sidebar Toggle
    document.getElementById('btn-mobile-menu').addEventListener('click', () => {
        const nav = document.getElementById('sidebar-nav');
        nav.classList.toggle('hidden');
    });

    // Global Search Input
    document.getElementById('global-search').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (query) {
            switchView('view-patients');
            const patientSearch = document.getElementById('patient-search-input');
            if (patientSearch) {
                patientSearch.value = query;
                filterPatientsTable(query);
            }
        }
    });

    // Patient Search Input Filter
    document.getElementById('patient-search-input').addEventListener('input', (e) => {
        filterPatientsTable(e.target.value.toLowerCase().trim());
    });

    // Quick Action Button
    document.getElementById('btn-quick-action').addEventListener('click', () => {
        openModal('modal-patient');
    });

    // Modal Open Buttons
    document.getElementById('btn-open-patient-modal').addEventListener('click', () => openModal('modal-patient'));
    document.getElementById('btn-open-encounter-modal').addEventListener('click', () => {
        populateEncounterPatientDropdown();
        openModal('modal-encounter');
    });
    document.getElementById('btn-open-lab-modal').addEventListener('click', () => {
        populateLabEncounterDropdown();
        openModal('modal-lab');
    });

    // Modal Close Buttons
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', () => closeModal());
    });

    // Form Submissions
    document.getElementById('form-patient').addEventListener('submit', handleAddPatient);
    document.getElementById('form-encounter').addEventListener('submit', handleAddEncounter);
    document.getElementById('form-lab').addEventListener('submit', handleAddLab);
}

// ==========================================
// VIEW ROUTING
// ==========================================
function switchView(viewId) {
    const views = ['view-dashboard', 'view-patients', 'view-encounters', 'view-labs'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const activeView = document.getElementById(viewId);
    if (activeView) activeView.classList.remove('hidden');

    // Update Nav Active State
    document.querySelectorAll('#sidebar-nav .nav-item').forEach(btn => {
        if (btn.getAttribute('data-target') === viewId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update Header Text & Quick Action Label
    const titleEl = document.getElementById('page-title');
    const subTitleEl = document.getElementById('page-subtitle');
    const quickLabel = document.getElementById('quick-action-label');

    if (viewId === 'view-dashboard') {
        titleEl.textContent = 'Dashboard Overview';
        subTitleEl.textContent = 'Real-time clinical metrics & summary';
        quickLabel.textContent = 'New Patient';
        loadDashboardData();
    } else if (viewId === 'view-patients') {
        titleEl.textContent = 'Patient Directory';
        subTitleEl.textContent = 'Comprehensive medical record index';
        quickLabel.textContent = 'New Patient';
        loadPatientsData();
    } else if (viewId === 'view-encounters') {
        titleEl.textContent = 'Clinical Encounters';
        subTitleEl.textContent = 'Documented patient consultations & progress notes';
        quickLabel.textContent = 'New Encounter';
        loadEncountersData();
    } else if (viewId === 'view-labs') {
        titleEl.textContent = 'Lab Measurements';
        subTitleEl.textContent = 'Diagnostic test results & alert flags';
        quickLabel.textContent = 'Log Lab Result';
        loadLabsData();
    }

    initLucideIcons();
}

// ==========================================
// DATA FETCHING & RENDERING
// ==========================================

// --- DASHBOARD ---
async function loadDashboardData() {
    try {
        // Fetch Patient Count
        const { count: patientCount, error: pErr } = await supabase
            .from('patients')
            .select('*', { count: 'exact', head: true });
        if (pErr) throw pErr;
        document.getElementById('stat-total-patients').textContent = patientCount || '0';

        // Fetch Encounters Count
        const { count: encounterCount, error: eErr } = await supabase
            .from('encounters')
            .select('*', { count: 'exact', head: true });
        if (eErr) throw eErr;
        document.getElementById('stat-today-encounters').textContent = encounterCount || '0';

        // Fetch Abnormal Labs Count
        const { count: abnormalCount, error: aErr } = await supabase
            .from('lab_results')
            .select('*', { count: 'exact', head: true })
            .eq('is_abnormal', true);
        if (aErr) throw aErr;
        document.getElementById('stat-abnormal-labs').textContent = abnormalCount || '0';

        // Fetch Providers Count
        const { count: providerCount, error: prErr } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });
        if (prErr) throw prErr;
        document.getElementById('stat-active-providers').textContent = providerCount || '1';

        // Load Dashboard Lists
        await loadRecentEncountersList();
        await loadAbnormalLabsList();
    } catch (err) {
        console.error('Dashboard load error:', err);
    }
}

async function loadRecentEncountersList() {
    const container = document.getElementById('dash-recent-encounters');
    try {
        const { data, error } = await supabase
            .from('encounters')
            .select('id, encounter_date, chief_complaint, status, patients(first_name, last_name, mrn)')
            .order('encounter_date', { ascending: false })
            .limit(4);

        if (error) throw error;

        if (!data || data.length === 0) {
            container.innerHTML = `<p class="text-xs text-slate-500 py-2">No recent encounters documented.</p>`;
            return;
        }

        container.innerHTML = data.map(enc => `
            <div class="p-3 bg-slate-900/60 rounded-lg border border-slate-800 flex justify-between items-center text-xs">
                <div>
                    <p class="font-bold text-slate-200">${escapeHtml(enc.patients?.first_name || '')} ${escapeHtml(enc.patients?.last_name || '')} <span class="text-[10px] text-teal-400 font-mono">(${escapeHtml(enc.patients?.mrn || '')})</span></p>
                    <p class="text-slate-400 text-[11px]">${escapeHtml(enc.chief_complaint)}</p>
                </div>
                <div class="text-right">
                    <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${getStatusBadgeClass(enc.status)}">${escapeHtml(enc.status)}</span>
                    <p class="text-[10px] text-slate-500 mt-1">${formatDate(enc.encounter_date)}</p>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<p class="text-xs text-rose-400 py-2">Failed to load recent encounters.</p>`;
    }
}

async function loadAbnormalLabsList() {
    const container = document.getElementById('dash-abnormal-labs');
    try {
        const { data, error } = await supabase
            .from('lab_results')
            .select('id, test_name, value, unit, reference_range, result_date, patients(first_name, last_name)')
            .eq('is_abnormal', true)
            .order('result_date', { ascending: false })
            .limit(4);

        if (error) throw error;

        if (!data || data.length === 0) {
            container.innerHTML = `<p class="text-xs text-slate-500 py-2">No critical abnormal flags registered.</p>`;
            return;
        }

        container.innerHTML = data.map(lab => `
            <div class="p-3 bg-amber-950/20 rounded-lg border border-amber-900/40 flex justify-between items-center text-xs">
                <div>
                    <p class="font-bold text-amber-200">${escapeHtml(lab.test_name)}: <span class="text-amber-400 font-mono">${lab.value} ${escapeHtml(lab.unit)}</span></p>
                    <p class="text-slate-400 text-[11px]">Patient: ${escapeHtml(lab.patients?.first_name || '')} ${escapeHtml(lab.patients?.last_name || '')}</p>
                </div>
                <div class="text-right">
                    <span class="text-[10px] font-semibold text-amber-400 bg-amber-950 px-1.5 py-0.5 rounded border border-amber-800">Flagged</span>
                    <p class="text-[10px] text-slate-500 mt-1">${formatDate(lab.result_date)}</p>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<p class="text-xs text-rose-400 py-2">Failed to load lab alerts.</p>`;
    }
}

// --- PATIENTS DIRECTORY ---
async function loadPatientsData() {
    const tbody = document.getElementById('patients-table-body');
    const emptyState = document.getElementById('patients-empty-state');
    
    tbody.innerHTML = `
        <tr>
            <td colspan="6" class="p-4"><div class="skeleton-loader h-8 w-full rounded"></div></td>
        </tr>
    `;

    try {
        const { data, error } = await supabase
            .from('patients')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        patientsData = data || [];

        renderPatientsTable(patientsData);
    } catch (err) {
        showToast(err.message, 'error');
        tbody.innerHTML = '';
        emptyState.classList.remove('hidden');
    }
}

function renderPatientsTable(list) {
    const tbody = document.getElementById('patients-table-body');
    const emptyState = document.getElementById('patients-empty-state');

    if (list.length === 0) {
        tbody.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    tbody.innerHTML = list.map(patient => `
        <tr class="hover:bg-slate-800/40 transition-colors">
            <td class="p-4 font-mono text-teal-400 font-semibold">${escapeHtml(patient.mrn)}</td>
            <td class="p-4 font-semibold text-slate-200">${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)}</td>
            <td class="p-4 text-slate-400">${patient.date_of_birth} (${calculateAge(patient.date_of_birth)} yrs)</td>
            <td class="p-4 text-slate-400">${escapeHtml(patient.gender || 'N/A')}</td>
            <td class="p-4 text-slate-400">${escapeHtml(patient.contact_number || 'None')}</td>
            <td class="p-4 text-right">
                <button class="btn-secondary py-1 px-2 text-[11px] inline-flex items-center gap-1" onclick="window.createQuickEncounter('${patient.id}')">
                    <i data-lucide="stethoscope" class="w-3 h-3"></i> Visit
                </button>
            </td>
        </tr>
    `).join('');

    initLucideIcons();
}

function filterPatientsTable(query) {
    if (!query) {
        renderPatientsTable(patientsData);
        return;
    }

    const filtered = patientsData.filter(p => 
        p.first_name.toLowerCase().includes(query) ||
        p.last_name.toLowerCase().includes(query) ||
        p.mrn.toLowerCase().includes(query)
    );
    renderPatientsTable(filtered);
}

// Global helper for quick encounter trigger
window.createQuickEncounter = function(patientId) {
    switchView('view-encounters');
    populateEncounterPatientDropdown(patientId);
    openModal('modal-encounter');
};

// --- CLINICAL ENCOUNTERS ---
async function loadEncountersData() {
    const container = document.getElementById('encounters-container');
    const emptyState = document.getElementById('encounters-empty-state');

    container.innerHTML = `
        <div class="skeleton-loader h-32 rounded-xl"></div>
        <div class="skeleton-loader h-32 rounded-xl"></div>
    `;

    try {
        const { data, error } = await supabase
            .from('encounters')
            .select('*, patients(first_name, last_name, mrn), profiles(full_name)')
            .order('encounter_date', { ascending: false });

        if (error) throw error;
        encountersData = data || [];

        if (encountersData.length === 0) {
            container.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        container.innerHTML = encountersData.map(enc => `
            <div class="card-glass p-5 rounded-xl border border-slate-800 space-y-3 relative">
                <div class="flex justify-between items-start">
                    <div>
                        <span class="text-[10px] font-mono text-teal-400">${escapeHtml(enc.patients?.mrn || 'MRN-N/A')}</span>
                        <h4 class="text-sm font-bold text-white">${escapeHtml(enc.patients?.first_name || '')} ${escapeHtml(enc.patients?.last_name || '')}</h4>
                    </div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${getStatusBadgeClass(enc.status)}">${escapeHtml(enc.status)}</span>
                </div>

                <div>
                    <p class="text-xs font-semibold text-slate-300">Chief Complaint:</p>
                    <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(enc.chief_complaint)}</p>
                </div>

                ${enc.clinical_notes ? `
                    <div class="bg-slate-900/80 p-3 rounded-lg border border-slate-800/80 text-[11px] text-slate-300">
                        <p class="font-medium text-slate-400 text-[10px] uppercase tracking-wider mb-1">Assessment & Plan</p>
                        ${escapeHtml(enc.clinical_notes)}
                    </div>
                ` : ''}

                <div class="pt-2 border-t border-slate-800/80 flex justify-between items-center text-[11px] text-slate-500">
                    <span>Provider: ${escapeHtml(enc.profiles?.full_name || 'Staff')}</span>
                    <span>${formatDate(enc.encounter_date)}</span>
                </div>
            </div>
        `).join('');

        initLucideIcons();
    } catch (err) {
        showToast(err.message, 'error');
        container.innerHTML = '';
        emptyState.classList.remove('hidden');
    }
}

// --- LAB MEASUREMENTS ---
async function loadLabsData() {
    const tbody = document.getElementById('labs-table-body');
    const emptyState = document.getElementById('labs-empty-state');

    tbody.innerHTML = `
        <tr>
            <td colspan="6" class="p-4"><div class="skeleton-loader h-8 w-full rounded"></div></td>
        </tr>
    `;

    try {
        const { data, error } = await supabase
            .from('lab_results')
            .select('*, patients(first_name, last_name, mrn)')
            .order('result_date', { ascending: false });

        if (error) throw error;
        labsData = data || [];

        if (labsData.length === 0) {
            tbody.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        tbody.innerHTML = labsData.map(lab => `
            <tr class="hover:bg-slate-800/40 transition-colors">
                <td class="p-4 text-slate-400">${formatDate(lab.result_date)}</td>
                <td class="p-4 font-semibold text-slate-200">
                    ${escapeHtml(lab.patients?.first_name || '')} ${escapeHtml(lab.patients?.last_name || '')}
                    <span class="block text-[10px] text-teal-400 font-mono">${escapeHtml(lab.patients?.mrn || '')}</span>
                </td>
                <td class="p-4 font-medium text-slate-200">${escapeHtml(lab.test_name)}</td>
                <td class="p-4 font-bold font-mono ${lab.is_abnormal ? 'text-amber-400' : 'text-emerald-400'}">
                    ${lab.value} <span class="text-xs font-normal text-slate-400">${escapeHtml(lab.unit)}</span>
                </td>
                <td class="p-4 text-slate-400">${escapeHtml(lab.reference_range || 'N/A')}</td>
                <td class="p-4">
                    ${lab.is_abnormal ? 
                        `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/80 text-amber-400 border border-amber-800">Abnormal Flag</span>` : 
                        `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400">Normal</span>`}
                </td>
            </tr>
        `).join('');

        initLucideIcons();
    } catch (err) {
        showToast(err.message, 'error');
        tbody.innerHTML = '';
        emptyState.classList.remove('hidden');
    }
}

// ==========================================
// FORM SUBMISSIONS & MODALS
// ==========================================

async function handleAddPatient(e) {
    e.preventDefault();
    const firstName = document.getElementById('patient-firstname').value.trim();
    const lastName = document.getElementById('patient-lastname').value.trim();
    const mrn = document.getElementById('patient-mrn').value.trim();
    const dob = document.getElementById('patient-dob').value;
    const gender = document.getElementById('patient-gender').value;
    const phone = document.getElementById('patient-phone').value.trim();
    const history = document.getElementById('patient-history').value.trim();

    try {
        const { error } = await supabase.from('patients').insert([{
            mrn,
            first_name: firstName,
            last_name: lastName,
            date_of_birth: dob,
            gender,
            contact_number: phone,
            medical_history: history
        }]);

        if (error) throw error;

        showToast('Patient record saved successfully', 'success');
        closeModal();
        document.getElementById('form-patient').reset();
        loadPatientsData();
        loadDashboardData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleAddEncounter(e) {
    e.preventDefault();
    const patientId = document.getElementById('encounter-patient-id').value;
    const status = document.getElementById('encounter-status').value;
    const date = document.getElementById('encounter-date').value;
    const complaint = document.getElementById('encounter-complaint').value.trim();
    const notes = document.getElementById('encounter-notes').value.trim();

    if (!patientId) {
        showToast('Please select a valid patient', 'error');
        return;
    }

    try {
        const { error } = await supabase.from('encounters').insert([{
            patient_id: patientId,
            provider_id: currentUser.id,
            status,
            encounter_date: date || new Date().toISOString(),
            chief_complaint: complaint,
            clinical_notes: notes
        }]);

        if (error) throw error;

        showToast('Encounter recorded successfully', 'success');
        closeModal();
        document.getElementById('form-encounter').reset();
        loadEncountersData();
        loadDashboardData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleAddLab(e) {
    e.preventDefault();
    const encounterId = document.getElementById('lab-encounter-id').value;
    const testName = document.getElementById('lab-test-name').value.trim();
    const value = parseFloat(document.getElementById('lab-value').value);
    const unit = document.getElementById('lab-unit').value.trim();
    const refRange = document.getElementById('lab-ref-range').value.trim();
    const isAbnormal = document.getElementById('lab-abnormal').checked;

    if (!encounterId) {
        showToast('Please select a valid encounter', 'error');
        return;
    }

    try {
        // Fetch patient_id associated with selected encounter
        const { data: enc, error: encErr } = await supabase
            .from('encounters')
            .select('patient_id')
            .eq('id', encounterId)
            .single();

        if (encErr) throw encErr;

        const { error } = await supabase.from('lab_results').insert([{
            encounter_id: encounterId,
            patient_id: enc.patient_id,
            test_name: testName,
            value: value,
            unit: unit,
            reference_range: refRange,
            is_abnormal: isAbnormal
        }]);

        if (error) throw error;

        showToast('Laboratory test recorded successfully', 'success');
        closeModal();
        document.getElementById('form-lab').reset();
        loadLabsData();
        loadDashboardData();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Helpers to populate select dropdowns dynamically
async function populateEncounterPatientDropdown(selectedId = null) {
    const select = document.getElementById('encounter-patient-id');
    select.innerHTML = '<option value="">Loading patients...</option>';

    try {
        const { data, error } = await supabase
            .from('patients')
            .select('id, first_name, last_name, mrn')
            .order('last_name', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            select.innerHTML = '<option value="">No patients registered</option>';
            return;
        }

        select.innerHTML = data.map(p => `
            <option value="${p.id}" ${selectedId === p.id ? 'selected' : ''}>
                ${escapeHtml(p.last_name)}, ${escapeHtml(p.first_name)} (${escapeHtml(p.mrn)})
            </option>
        `).join('');
    } catch (err) {
        select.innerHTML = '<option value="">Error loading patients</option>';
    }
}

async function populateLabEncounterDropdown() {
    const select = document.getElementById('lab-encounter-id');
    select.innerHTML = '<option value="">Loading encounters...</option>';

    try {
        const { data, error } = await supabase
            .from('encounters')
            .select('id, chief_complaint, encounter_date, patients(first_name, last_name)')
            .order('encounter_date', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            select.innerHTML = '<option value="">No encounters recorded</option>';
            return;
        }

        select.innerHTML = data.map(e => `
            <option value="${e.id}">
                ${escapeHtml(e.patients?.first_name || '')} ${escapeHtml(e.patients?.last_name || '')} - ${escapeHtml(e.chief_complaint)} (${formatDate(e.encounter_date)})
            </option>
        `).join('');
    } catch (err) {
        select.innerHTML = '<option value="">Error loading encounters</option>';
    }
}

// Modal Helpers
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden');
}

function closeModal() {
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
        modal.classList.add('hidden');
    });
}

// Formatters & Utility Functions
function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function calculateAge(dobStr) {
    if (!dobStr) return 'N/A';
    const dob = new Date(dobStr);
    const diffMs = Date.now() - dob.getTime();
    const ageDate = new Date(diffMs);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
}

function getStatusBadgeClass(status) {
    switch (status) {
        case 'completed': return 'bg-emerald-950/80 text-emerald-400 border border-emerald-800';
        case 'in-progress': return 'bg-indigo-950/80 text-indigo-400 border border-indigo-800';
        case 'scheduled': return 'bg-teal-950/80 text-teal-400 border border-teal-800';
        case 'cancelled': return 'bg-rose-950/80 text-rose-400 border border-rose-800';
        default: return 'bg-slate-800 text-slate-400';
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
