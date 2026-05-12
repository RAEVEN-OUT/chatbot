/**
 * Site Owner Portal - Group & Site Management
 */

// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBjbZ0uRMa2yUmYOSzbjKf2C0unNYTDJ7Q",
    authDomain: "chatbot-faq-76909.firebaseapp.com",
    projectId: "chatbot-faq-76909",
};

// --- STATE ---
let currentUser = null;
let sites = [];
let groups = [];
let currentSiteId = null;
let currentGroupId = null;
let faqs = [];

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// --- DOM ELEMENTS ---
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const loginForm = document.getElementById('login-form');
const siteSelector = document.getElementById('site-selector');
const groupSelector = document.getElementById('group-selector');
const faqList = document.getElementById('faq-list');
const faqModal = document.getElementById('faq-modal');
const faqForm = document.getElementById('faq-form');
const groupModal = document.getElementById('group-modal');
const groupForm = document.getElementById('group-form');

// --- AUTH LOGIC ---
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        showDashboard();
    } else {
        showLogin();
    }
});

function showLogin() {
    authSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
}

async function showDashboard() {
    authSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    document.getElementById('user-email').textContent = currentUser.email;
    await loadInitialData();
}

loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('login-error');
    try {
        errorDiv.classList.add('hidden');
        await auth.signInWithEmailAndPassword(email, pass);
    } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.classList.remove('hidden');
    }
};

document.getElementById('logout-btn').onclick = () => auth.signOut();

// --- API HELPERS ---
async function apiFetch(path, options = {}) {
    const token = await currentUser.getIdToken();
    const response = await fetch(path, {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || 'API Error');
    }
    if (response.status === 204) return null;
    return response.json();
}

// --- DATA LOADING ---
async function loadInitialData() {
    try {
        const [sitesData, groupsData] = await Promise.all([
            apiFetch('/api/sites'),
            apiFetch('/api/groups')
        ]);
        
        sites = sitesData;
        groups = groupsData;
        
        renderSelectors();
        
        if (sites.length > 0) {
            currentSiteId = sites[0].id;
            currentGroupId = null;
            groupSelector.value = "";
            siteSelector.value = currentSiteId;
            loadFaqs();
            loadAnalytics();
        }
    } catch (err) {
        alert('Failed to load data: ' + err.message);
    }
}

function renderSelectors() {
    siteSelector.innerHTML = sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    groupSelector.innerHTML = '<option value="">-- No Group Selected --</option>' + 
        groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
}

siteSelector.onchange = (e) => {
    currentSiteId = e.target.value;
    currentGroupId = null;
    groupSelector.value = "";
    loadFaqs();
    loadAnalytics();
};

groupSelector.onchange = (e) => {
    currentGroupId = e.target.value;
    if (currentGroupId) {
        currentSiteId = null;
        siteSelector.value = "";
    } else {
        currentSiteId = siteSelector.value;
    }
    loadFaqs();
    loadAnalytics();
};

// --- FAQ MANAGEMENT ---
async function loadFaqs() {
    faqList.innerHTML = '<div style="text-align: center; padding: 3rem;">Loading FAQs...</div>';
    try {
        let url = '/api/faqs';
        if (currentSiteId) url += `?site_id=${currentSiteId}`;
        else if (currentGroupId) url += `?group_id=${currentGroupId}`;
        
        faqs = await apiFetch(url);
        document.getElementById('stat-faqs').textContent = faqs.length;
        renderFaqs();
    } catch (err) {
        faqList.innerHTML = `<div style="text-align: center; padding: 3rem; color: #ef4444;">Error: ${err.message}</div>`;
    }
}

function renderFaqs() {
    if (faqs.length === 0) {
        faqList.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">No FAQs found for this selection.</div>';
        return;
    }
    
    faqList.innerHTML = faqs.map(faq => `
        <div class="faq-item">
            <div class="faq-content">
                <div class="faq-question">${escapeHtml(faq.question)}</div>
                <div class="faq-answer">${escapeHtml(faq.answer)}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.5rem;">
                    ${faq.site_ids.length > 0 ? 'Sites: ' + faq.site_ids.join(', ') : ''}
                    ${faq.group_ids.length > 0 ? ' Groups: ' + faq.group_ids.join(', ') : ''}
                </div>
            </div>
            <div class="faq-actions" style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary btn-sm" onclick="editFaq('${faq.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteFaq('${faq.id}')">Delete</button>
            </div>
        </div>
    `).join('');
}

async function loadAnalytics() {
    if (!currentSiteId) {
        // Stats for groups could be an aggregate, but let's clear for now
        document.getElementById('stat-total').textContent = '-';
        document.getElementById('stat-hits').textContent = '-';
        return;
    }
    try {
        const stats = await apiFetch(`/api/sites/${currentSiteId}/analytics`);
        document.getElementById('stat-total').textContent = stats.total_queries;
        document.getElementById('stat-hits').textContent = stats.hit_rate + '%';
    } catch (err) {
        console.error('Stats error:', err);
    }
}

// --- FAQ MODAL ---
document.getElementById('add-faq-btn').onclick = () => {
    if (!currentSiteId && !currentGroupId) return alert('Select a site or group first');
    document.getElementById('modal-title').textContent = 'Add FAQ';
    faqForm.reset();
    document.getElementById('faq-id').value = '';
    faqModal.classList.remove('hidden');
};

document.getElementById('close-modal-btn').onclick = () => faqModal.classList.add('hidden');

window.editFaq = (id) => {
    const faq = faqs.find(f => f.id === id);
    if (!faq) return;
    document.getElementById('modal-title').textContent = 'Edit FAQ';
    document.getElementById('faq-id').value = faq.id;
    document.getElementById('faq-question').value = faq.question;
    document.getElementById('faq-answer').value = faq.answer;
    document.getElementById('faq-aliases').value = faq.aliases.join('\n');
    faqModal.classList.remove('hidden');
};

faqForm.onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('faq-id').value;
    const payload = {
        question: document.getElementById('faq-question').value,
        answer: document.getElementById('faq-answer').value,
        aliases: document.getElementById('faq-aliases').value.split('\n').filter(a => a.trim()),
        site_ids: currentSiteId ? [currentSiteId] : [],
        group_ids: currentGroupId ? [currentGroupId] : []
    };
    
    try {
        if (id) await apiFetch(`/api/faqs/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        else await apiFetch('/api/faqs', { method: 'POST', body: JSON.stringify(payload) });
        faqModal.classList.add('hidden');
        loadFaqs();
    } catch (err) {
        alert('Error saving FAQ: ' + err.message);
    }
};

window.deleteFaq = async (id) => {
    if (!confirm('Are you sure you want to delete this FAQ?')) return;
    try {
        await apiFetch(`/api/faqs/${id}`, { method: 'DELETE' });
        loadFaqs();
    } catch (err) {
        alert('Error deleting FAQ: ' + err.message);
    }
};

// --- GROUP MODAL ---
document.getElementById('manage-groups-btn').onclick = () => {
    renderGroupList();
    groupModal.classList.remove('hidden');
    document.getElementById('group-editor').classList.add('hidden');
};

document.getElementById('close-group-modal-btn').onclick = () => groupModal.classList.add('hidden');

function renderGroupList() {
    const container = document.getElementById('group-list-container');
    if (groups.length === 0) {
        container.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">No groups yet.</div>';
        return;
    }
    container.innerHTML = groups.map(g => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border);">
            <div>
                <div style="font-weight: 600;">${escapeHtml(g.name)}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${g.site_ids.length} Sites</div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary btn-sm" onclick="editGroup('${g.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteGroup('${g.id}')">Delete</button>
            </div>
        </div>
    `).join('');
}

document.getElementById('new-group-btn').onclick = () => {
    document.getElementById('editor-title').textContent = 'Create New Group';
    groupForm.reset();
    document.getElementById('group-id').value = '';
    renderSiteCheckboxes([]);
    document.getElementById('group-editor').classList.remove('hidden');
};

window.editGroup = (id) => {
    const group = groups.find(g => g.id === id);
    if (!group) return;
    document.getElementById('editor-title').textContent = 'Edit Group';
    document.getElementById('group-id').value = group.id;
    document.getElementById('group-name').value = group.name;
    renderSiteCheckboxes(group.site_ids);
    document.getElementById('group-editor').classList.remove('hidden');
};

function renderSiteCheckboxes(selectedIds) {
    const container = document.getElementById('group-sites-list');
    container.innerHTML = sites.map(s => `
        <label style="display: flex; align-items: center; gap: 0.5rem; font-weight: 400; cursor: pointer; margin-bottom: 0;">
            <input type="checkbox" name="site_check" value="${s.id}" ${selectedIds.includes(s.id) ? 'checked' : ''} style="width: auto;">
            ${escapeHtml(s.name)}
        </label>
    `).join('');
}

groupForm.onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('group-id').value;
    const selectedSites = Array.from(document.querySelectorAll('input[name="site_check"]:checked')).map(el => el.value);
    
    if (selectedSites.length === 0) return alert('Select at least one site');
    
    const payload = {
        name: document.getElementById('group-name').value,
        site_ids: selectedSites
    };
    
    try {
        if (id) await apiFetch(`/api/groups/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        else await apiFetch('/api/groups', { method: 'POST', body: JSON.stringify(payload) });
        document.getElementById('group-editor').classList.add('hidden');
        await loadInitialData();
        renderGroupList();
    } catch (err) {
        alert('Error saving group: ' + err.message);
    }
};

window.deleteGroup = async (id) => {
    if (!confirm('Are you sure? FAQs in this group will stop showing on these sites.')) return;
    try {
        await apiFetch(`/api/groups/${id}`, { method: 'DELETE' });
        await loadInitialData();
        renderGroupList();
    } catch (err) {
        alert('Error deleting group: ' + err.message);
    }
};

document.getElementById('cancel-group-btn').onclick = () => document.getElementById('group-editor').classList.add('hidden');

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
