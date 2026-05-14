<<<<<<< HEAD
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
=======
const state = { sites: [], groups: [], faqs: [], logs: [], currentSiteId: "", currentGroupId: "", sessionId: "", principal: null };
const $ = (id) => document.getElementById(id);

const firebaseConfig = {
  apiKey: "AIzaSyC1QxlKBkLpT2htParIuodhPNX6qtTGnlU",
  authDomain: "chatbot-faq-76909.firebaseapp.com",
  projectId: "chatbot-faq-76909",
};

let portalApp;
try { portalApp = firebase.initializeApp(firebaseConfig, "PortalApp"); } catch { portalApp = firebase.app("PortalApp"); }
const auth = firebase.auth(portalApp);

(async () => {
  await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      try {
        localStorage.setItem("portal_session", await user.getIdToken());
        $("userEmail").textContent = user.email;
        $("logoutBtn").style.display = "inline-block";
        hideLogin();
        await bootstrapPortal();
      } catch (error) {
        console.error(error);
        auth.signOut();
      }
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const handoff = params.get("handoff");
    if (handoff) {
      window.history.replaceState({}, document.title, window.location.pathname + (params.get("site_id") ? `?site_id=${params.get("site_id")}` : ""));
      await auth.signInWithCustomToken(handoff);
      return;
    }

    localStorage.removeItem("portal_session");
    $("userEmail").textContent = "";
    $("logoutBtn").style.display = "none";
    showLogin();
  });
})();

async function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem("portal_session");
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
  return headers;
}

async function api(path, options = {}) {
  const headers = await authHeaders(options.headers || {});
  if (options.body instanceof FormData) delete headers["Content-Type"];
  setLoading(true);
  try {
    const res = await fetch(path.startsWith("/") ? path : `/${path}`, { ...options, headers });
    const bodyText = res.status === 204 ? "" : await res.text();
    if (res.status === 401) {
      localStorage.removeItem("portal_session");
      const detail = parseApiError(bodyText);
      throw new Error(detail ? `Session rejected: ${detail}` : "Session rejected. Sign out, sign in again, and check Firebase site claims.");
    }
    if (!res.ok) throw new Error(parseApiError(bodyText) || `Request failed: ${res.status}`);
    if (res.status === 204) return null;
    return bodyText ? JSON.parse(bodyText) : null;
  } finally {
    setLoading(false);
  }
}

function parseApiError(bodyText = "") {
  if (!bodyText) return "";
  try {
    const data = JSON.parse(bodyText);
    if (typeof data.detail === "string") return data.detail;
    return JSON.stringify(data.detail || data);
  } catch {
    return bodyText;
  }
}

function showLogin() { $("loginOverlay").classList.add("active"); $("mainLayout").style.display = "none"; }
function hideLogin() { $("loginOverlay").classList.remove("active"); $("mainLayout").style.display = "grid"; }
function setStatus(text) { $("statusText").textContent = text; }
function setLoading(on) { $("globalLoading").style.display = on ? "inline-block" : "none"; }
function esc(v = "") { return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function formatDate(value) { return value ? new Date(value).toLocaleString() : "n/a"; }
function recentStamp(record) {
  const created = record.created_at ? new Date(record.created_at).getTime() : 0;
  const updated = record.updated_at ? new Date(record.updated_at).getTime() : 0;
  return updated && updated > created + 1000 ? `Updated ${formatDate(record.updated_at)}` : `Created ${formatDate(record.created_at)}`;
>>>>>>> dev
}
function siteDisplay(site) { return site ? `${site.name} (${site.id})` : ""; }
function groupDisplay(group) { return group ? `${group.name} (${group.id})` : ""; }
function idFromChooser(value, items) {
  const trimmed = value.trim();
  const paren = trimmed.match(/\(([^()]+)\)$/);
  const candidate = paren ? paren[1] : trimmed;
  return items.find((item) => item.id === candidate || item.name === trimmed)?.id || candidate;
}
function currentSite() { return state.sites.find((site) => site.id === state.currentSiteId); }

<<<<<<< HEAD
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
=======
<<<<<<< HEAD
=======
const state = { sites: [], groups: [], faqs: [], logs: [], currentSiteId: "", currentGroupId: "", sessionId: "", principal: null };
const $ = (id) => document.getElementById(id);

const firebaseConfig = {
  apiKey: "AIzaSyC1QxlKBkLpT2htParIuodhPNX6qtTGnlU",
  authDomain: "chatbot-faq-76909.firebaseapp.com",
  projectId: "chatbot-faq-76909",
};

let portalApp;
try { portalApp = firebase.initializeApp(firebaseConfig, "PortalApp"); } catch { portalApp = firebase.app("PortalApp"); }
const auth = firebase.auth(portalApp);

(async () => {
  await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      try {
        localStorage.setItem("portal_session", await user.getIdToken());
        $("userEmail").textContent = user.email;
        $("logoutBtn").style.display = "inline-block";
        hideLogin();
        await bootstrapPortal();
      } catch (error) {
        console.error(error);
        auth.signOut();
      }
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const handoff = params.get("handoff");
    if (handoff) {
      window.history.replaceState({}, document.title, window.location.pathname + (params.get("site_id") ? `?site_id=${params.get("site_id")}` : ""));
      await auth.signInWithCustomToken(handoff);
      return;
    }

    localStorage.removeItem("portal_session");
    $("userEmail").textContent = "";
    $("logoutBtn").style.display = "none";
    showLogin();
  });
})();

async function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem("portal_session");
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
  return headers;
}

async function api(path, options = {}) {
  const headers = await authHeaders(options.headers || {});
  if (options.body instanceof FormData) delete headers["Content-Type"];
  setLoading(true);
  try {
    const res = await fetch(path.startsWith("/") ? path : `/${path}`, { ...options, headers });
    if (res.status === 401) {
      localStorage.removeItem("portal_session");
      throw new Error("Session expired. Please refresh and try again.");
    }
    if (!res.ok) throw new Error(await res.text() || `Request failed: ${res.status}`);
    if (res.status === 204) return null;
    return res.json();
  } finally {
    setLoading(false);
  }
}

function showLogin() { $("loginOverlay").classList.add("active"); $("mainLayout").style.display = "none"; }
function hideLogin() { $("loginOverlay").classList.remove("active"); $("mainLayout").style.display = "grid"; }
function setStatus(text) { $("statusText").textContent = text; }
function setLoading(on) { $("globalLoading").style.display = on ? "inline-block" : "none"; }
function esc(v = "") { return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function formatDate(value) { return value ? new Date(value).toLocaleString() : "n/a"; }
function recentStamp(record) {
  const created = record.created_at ? new Date(record.created_at).getTime() : 0;
  const updated = record.updated_at ? new Date(record.updated_at).getTime() : 0;
  return updated && updated > created + 1000 ? `Updated ${formatDate(record.updated_at)}` : `Created ${formatDate(record.created_at)}`;
}
function siteDisplay(site) { return site ? `${site.name} (${site.id})` : ""; }
function groupDisplay(group) { return group ? `${group.name} (${group.id})` : ""; }
function idFromChooser(value, items) {
  const trimmed = value.trim();
  const paren = trimmed.match(/\(([^()]+)\)$/);
  const candidate = paren ? paren[1] : trimmed;
  return items.find((item) => item.id === candidate || item.name === trimmed)?.id || candidate;
}
function currentSite() { return state.sites.find((site) => site.id === state.currentSiteId); }

>>>>>>> 9e162b1fae78ae3979f86e3c770b837b9c0be1ff
async function bootstrapPortal() {
  setStatus("Loading...");
  const [me, sites, groups] = await Promise.all([api("/api/me"), api("/api/sites"), api("/api/groups")]);
  state.principal = me;
  state.sites = sites;
  state.groups = groups;
  if (!state.sites.length) return showNoAccess();
  const params = new URLSearchParams(window.location.search);
  state.currentSiteId = params.get("site_id") || state.currentSiteId || state.sites[0].id;
  renderReferenceControls();
  syncSiteChooser();
  renderGroups();
  await Promise.all([refreshFaqs(), refreshLogs(), refreshAnalytics()]);
  prefillSettings();
  renderSnippet();
  setStatus(`${me.email} | owner`);
}

function showNoAccess() {
  $("mainLayout").style.display = "grid";
  document.querySelector(".content").innerHTML = `<div class="no-access"><h2>No Site Access</h2><p>Create a site from registration or contact support.</p></div>`;
}

function renderReferenceControls() {
  $("siteOptions").innerHTML = state.sites.map((site) => `<option value="${esc(siteDisplay(site))}"></option>`).join("");
  $("groupOptions").innerHTML = state.groups.map((group) => `<option value="${esc(groupDisplay(group))}"></option>`).join("");
  $("siteChooser").style.display = state.sites.length > 1 ? "inline-block" : "none";
  document.querySelector('[data-tab="groups"]').style.display = state.sites.length > 1 ? "block" : "none";
}

function syncSiteChooser() {
  $("siteChooser").value = siteDisplay(currentSite());
  $("testerSiteName").textContent = currentSite()?.name || "No site selected";
}

function selectSite(siteId) {
  state.currentSiteId = siteId;
  state.currentGroupId = "";
  state.sessionId = "";
  syncSiteChooser();
  $("testMessages").innerHTML = "";
  $("leadForm").classList.remove("hidden");
  $("testForm").classList.add("hidden");
  refreshFaqs();
  refreshLogs();
  refreshAnalytics();
  prefillSettings();
  renderSnippet();
}

async function refreshFaqs() {
  const params = new URLSearchParams();
  if (state.currentGroupId) params.set("group_id", state.currentGroupId);
  else params.set("site_id", state.currentSiteId);
  state.faqs = await api(`/api/faqs?${params.toString()}`);
  renderFaqs();
}

function renderFaqs() {
  const query = $("faqSearch").value.trim().toLowerCase();
  const faqs = state.faqs.filter((faq) => !query || [faq.question, faq.answer, faq.id, ...(faq.aliases || [])].some((value) => String(value || "").toLowerCase().includes(query)));
  $("faqsList").innerHTML = faqs.length ? faqs.map((faq) => `
    <article class="faq-item">
      <div><h3>${esc(faq.question)}</h3><p class="meta">${recentStamp(faq)}</p></div>
      <div class="faq-answer">${esc(faq.answer)}</div>
      <p class="meta">Aliases: ${esc((faq.aliases || []).join(", ") || "none")}</p>
      <div class="actions"><button class="ghost" onclick="editFaq('${esc(faq.id)}')">Edit</button><button class="danger" onclick="deleteFaq('${esc(faq.id)}')">Delete</button></div>
    </article>`).join("") : `<p class="meta">No FAQs yet.</p>`;
}

async function refreshLogs() {
  const p = new URLSearchParams({ site_id: state.currentSiteId, limit: "200" });
  if ($("logTypeFilter").value) p.set("response_type", $("logTypeFilter").value);
  if ($("logDateFilter").value) p.set("since", $("logDateFilter").value);
  state.logs = await api(`/api/logs?${p.toString()}`);
  renderLogs();
}

function renderLogs() {
  const query = $("logSearch").value.trim().toLowerCase();
  const logs = state.logs.filter((log) => !query || [log.question, log.answer, log.email, log.phone, log.user_name].some((value) => String(value || "").toLowerCase().includes(query)));
  $("logsList").innerHTML = logs.length ? logs.map((log) => `
    <article class="log-item log-${esc(log.response_type)}">
      <div><h3>${esc(log.question)}</h3><p class="meta"><span class="badge">${esc(log.response_type.replaceAll("_", " "))}</span> ${formatDate(log.timestamp)}</p></div>
      <div class="log-answer">${esc(log.answer)}</div>
      <div class="actions"><button class="secondary" onclick="convertLog('${esc(log.id)}')">Add as FAQ</button></div>
    </article>`).join("") : `<p class="meta">No logs yet.</p>`;
}

async function refreshAnalytics() {
  const data = await api(`/api/sites/${state.currentSiteId}/analytics`);
  $("statTotal").textContent = data.total_queries;
  $("statHitRate").textContent = `${data.hit_rate}%`;
  $("statFaqHits").textContent = `${data.faq_hits} hits`;
  $("statLlmRate").textContent = `${data.llm_rate}%`;
  $("statLlmHits").textContent = `${data.llm_fallbacks} fallbacks`;
  $("statHelplineRate").textContent = `${data.helpline_rate}%`;
  $("topFaqsList").innerHTML = data.top_faqs.length ? data.top_faqs.map((faq) => `<div class="row"><p class="row-title">${esc(faq.question)}</p><div class="meta">${faq.count} uses</div><div></div></div>`).join("") : `<p class="meta">No FAQs used yet.</p>`;
}

function renderGroups() {
  $("groupSiteChecks").innerHTML = state.sites.map((site) => `<label><input name="groupSite" type="checkbox" value="${esc(site.id)}" /> ${esc(site.name)}</label>`).join("");
  const q = $("groupSearch").value.trim().toLowerCase();
  const groups = state.groups.filter((group) => !q || [group.name, group.id, group.description].some((value) => String(value || "").toLowerCase().includes(q)));
  $("groupsList").innerHTML = groups.length ? groups.map((group) => {
    const siteNames = group.site_ids.map((id) => state.sites.find((site) => site.id === id)?.name || id).join(", ");
    return `<div class="row"><div><p class="row-title">${esc(group.name)}</p><p class="meta">${recentStamp(group)}</p></div><div class="meta">${esc(siteNames)}</div><div class="actions"><button onclick="editGroup('${esc(group.id)}')" class="secondary">Edit</button><button onclick="deleteGroup('${esc(group.id)}')" class="danger">Delete</button></div></div>`;
  }).join("") : `<p class="meta">No groups yet.</p>`;
}

function selectedCheckboxValues(name) { return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value); }

function prefillSettings() {
  const site = currentSite();
  if (!site) return;
  $("setHelpline").value = site.helpline_number || "";
  $("setWelcome").value = site.welcome_message || "";
  $("setFallback").value = site.fallback_message || "";
  $("setAcceptDist").value = site.faq_accept_distance ?? "";
  $("setCandidateDist").value = site.llm_candidate_distance ?? "";
  $("setOrigins").value = (site.allowed_origins || []).join(", ");
  $("setPrimaryColor").value = site.primary_color || "#22c55e";
  $("setBotName").value = site.bot_name || "";
  $("setBotAvatar").value = site.bot_avatar_url || "";
  $("setLauncher").value = site.launcher_icon || "?";
  $("setActive").checked = site.active !== false;
}

function siteSettingsPayload(prefix) {
  return {
    name: $(`${prefix}Name`)?.value?.trim() || currentSite()?.name || "New site",
    domain: $(`${prefix}Domain`)?.value?.trim() || "",
    helpline_number: $(`${prefix}Helpline`)?.value?.trim() || "",
    welcome_message: $(`${prefix}Welcome`)?.value?.trim() || "Hi, how can I help?",
    fallback_message: $(`${prefix}Fallback`)?.value?.trim() || "I could not find the exact answer. Please contact our helpline.",
  };
}

function renderSnippet(targetId = "snippetCode") {
  if (!state.currentSiteId && targetId === "snippetCode") return;
  const origin = window.location.origin;
  const siteId = targetId === "snippetCode" ? state.currentSiteId : state.lastRegisteredSiteId;
  $(targetId).textContent = `<!-- FAQ Chatbot Widget -->\n<script src="${origin}/widget/chatbot-widget.js" data-site-id="${siteId}" data-api-base="${origin}" data-collect-lead="true"><\\/script>`;
}

window.editFaq = function editFaq(faqId) {
  const faq = state.faqs.find((item) => item.id === faqId);
  if (!faq) return;
  $("faqModalTitle").textContent = "Edit FAQ";
  $("faqId").value = faq.id;
  $("faqQuestion").value = faq.question;
  $("faqAliases").value = (faq.aliases || []).join("\n");
  $("faqAnswer").value = faq.answer;
  $("faqTargetGroup").value = faq.group_id ? groupDisplay(state.groups.find((group) => group.id === faq.group_id)) : "";
  $("faqModal").showModal();
};

window.deleteFaq = async function deleteFaq(faqId) {
  if (!confirm("Delete this FAQ?")) return;
  const prev = [...state.faqs];
  state.faqs = state.faqs.filter((faq) => faq.id !== faqId);
  renderFaqs();
  try { await api(`/api/faqs/${faqId}`, { method: "DELETE" }); } catch (error) { state.faqs = prev; renderFaqs(); alert(error.message); }
};

window.convertLog = async function convertLog(logId) {
  const log = state.logs.find((item) => item.id === logId);
  if (!log) return;
  const answer = prompt("Answer to save for this FAQ:", log.answer);
  if (!answer) return;
  const created = await api(`/api/logs/${logId}/convert-to-faq`, { method: "POST", body: JSON.stringify({ question: log.question, answer, aliases: [], site_id: log.site_id, group_id: "" }) });
  state.faqs.unshift(created);
  renderFaqs();
};

window.editGroup = function editGroup(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  $("groupId").value = group.id;
  $("groupName").value = group.name;
  $("groupDescription").value = group.description || "";
  document.querySelectorAll("input[name='groupSite']").forEach((input) => input.checked = group.site_ids.includes(input.value));
};

window.deleteGroup = async function deleteGroup(groupId) {
  if (!confirm("Delete this group?")) return;
  const prev = [...state.groups];
  state.groups = state.groups.filter((group) => group.id !== groupId);
  renderGroups();
  try { await api(`/api/groups/${groupId}`, { method: "DELETE" }); } catch (error) { state.groups = prev; renderGroups(); alert(error.message); }
};

function clearFaqForm() { $("faqId").value = ""; $("faqQuestion").value = ""; $("faqAliases").value = ""; $("faqAnswer").value = ""; $("faqTargetGroup").value = ""; }
function openFaqModal() { clearFaqForm(); $("faqModalTitle").textContent = "Add FAQ"; $("faqModal").showModal(); }

function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabId));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active-panel", panel.id === tabId));
  if (tabId === "settings") { prefillSettings(); renderSnippet(); }
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").textContent = "Signing in...";
  try {
    await auth.signInWithEmailAndPassword($("loginEmail").value, $("loginPassword").value);
    $("loginError").textContent = "";
  } catch (err) { $("loginError").textContent = err.message; }
});

$("showRegisterBtn").addEventListener("click", () => $("registerModal").showModal());
$("closeRegisterBtn").addEventListener("click", () => $("registerModal").close());
$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    email: $("regEmail").value.trim(),
    password: $("regPassword").value,
    site: {
      name: $("regSiteName").value.trim(),
      domain: $("regDomain").value.trim(),
      helpline_number: $("regHelpline").value.trim(),
      welcome_message: $("regWelcome").value.trim() || "Hi, how can I help?",
      fallback_message: $("regFallback").value.trim() || "I could not find the exact answer. Please contact our helpline.",
    },
  };
  const result = await fetch("/api/register-site-owner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(async (res) => {
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  });
  state.lastRegisteredSiteId = result.site.id;
  $("registerSnippetWrap").classList.remove("hidden");
  renderSnippet("registerSnippet");
  await auth.signInWithCustomToken(result.firebase_token);
});

$("logoutBtn").addEventListener("click", () => { auth.signOut(); localStorage.removeItem("portal_session"); showLogin(); });
$("refreshBtn").addEventListener("click", bootstrapPortal);
$("siteChooser").addEventListener("change", () => { const id = idFromChooser($("siteChooser").value, state.sites); if (id) selectSite(id); });
document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
$("createFaqBtn").addEventListener("click", openFaqModal);
$("closeFaqModalBtn").addEventListener("click", () => $("faqModal").close());
$("clearFaqBtn").addEventListener("click", clearFaqForm);
$("faqSearch").addEventListener("input", renderFaqs);
$("groupSearch").addEventListener("input", renderGroups);
$("logSearch").addEventListener("input", renderLogs);
["logTypeFilter", "logDateFilter"].forEach((id) => $(id).addEventListener("change", refreshLogs));
$("faqGroupChooser").addEventListener("change", () => {
  const id = idFromChooser($("faqGroupChooser").value, state.groups);
  state.currentGroupId = id;
  refreshFaqs();
});
$("faqTargetGroup").addEventListener("input", () => {
  state.currentGroupId = idFromChooser($("faqTargetGroup").value, state.groups);
});
$("addSiteBtn").addEventListener("click", () => $("siteModal").showModal());
$("closeSiteModalBtn").addEventListener("click", () => $("siteModal").close());

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    helpline_number: $("setHelpline").value.trim(),
    welcome_message: $("setWelcome").value.trim(),
    fallback_message: $("setFallback").value.trim(),
    allowed_origins: $("setOrigins").value.split(",").map((s) => s.trim()).filter(Boolean),
    primary_color: $("setPrimaryColor").value,
    bot_name: $("setBotName").value.trim() || "Support Bot",
    bot_avatar_url: $("setBotAvatar").value.trim(),
    launcher_icon: $("setLauncher").value.trim() || "?",
    active: $("setActive").checked,
  };
  if ($("setAcceptDist").value !== "") payload.faq_accept_distance = Number($("setAcceptDist").value);
  if ($("setCandidateDist").value !== "") payload.llm_candidate_distance = Number($("setCandidateDist").value);
  const idx = state.sites.findIndex((site) => site.id === state.currentSiteId);
  const prev = [...state.sites];
  if (idx !== -1) state.sites[idx] = { ...state.sites[idx], ...payload, updated_at: new Date().toISOString() };
  try {
    state.sites[idx] = await api(`/api/sites/${state.currentSiteId}`, { method: "PATCH", body: JSON.stringify(payload) });
    syncSiteChooser();
    renderSnippet();
  } catch (error) { state.sites = prev; alert(error.message); }
});

$("siteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = siteSettingsPayload("site");
  const temp = { ...payload, id: `saving-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  state.sites.unshift(temp);
  renderReferenceControls();
  try {
    const created = await api("/api/sites", { method: "POST", body: JSON.stringify(payload) });
    state.sites = state.sites.map((site) => site.id === temp.id ? created : site);
    state.currentSiteId = created.id;
    $("siteModal").close();
    renderReferenceControls();
    syncSiteChooser();
    renderSnippet();
  } catch (error) { state.sites = state.sites.filter((site) => site.id !== temp.id); alert(error.message); }
});

$("faqForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const groupId = idFromChooser($("faqTargetGroup").value, state.groups);
  const payload = {
    question: $("faqQuestion").value.trim(),
    answer: $("faqAnswer").value.trim(),
    aliases: $("faqAliases").value.split("\n").map((s) => s.trim()).filter(Boolean),
    site_id: groupId ? "" : state.currentSiteId,
    group_id: groupId || "",
    active: true,
  };
  const faqId = $("faqId").value.trim();
  const prev = [...state.faqs];
  try {
    if (faqId) {
      const idx = state.faqs.findIndex((faq) => faq.id === faqId);
      if (idx !== -1) state.faqs[idx] = { ...state.faqs[idx], ...payload, updated_at: new Date().toISOString() };
      renderFaqs();
      const updated = await api(`/api/faqs/${faqId}`, { method: "PATCH", body: JSON.stringify(payload) });
      if (idx !== -1) state.faqs[idx] = updated;
    } else {
      const temp = { ...payload, id: `saving-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.faqs.unshift(temp);
      renderFaqs();
      const created = await api("/api/faqs", { method: "POST", body: JSON.stringify(payload) });
      state.faqs = state.faqs.map((faq) => faq.id === temp.id ? created : faq);
    }
    renderFaqs();
    $("faqModal").close();
    refreshAnalytics();
  } catch (err) { state.faqs = prev; renderFaqs(); alert(err.message); }
});

$("groupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const groupId = $("groupId").value.trim();
  const payload = { id: groupId || undefined, name: $("groupName").value.trim(), description: $("groupDescription").value.trim(), site_ids: selectedCheckboxValues("groupSite"), active: true };
  const prev = [...state.groups];
  try {
    if (groupId && state.groups.some((group) => group.id === groupId)) {
      const idx = state.groups.findIndex((group) => group.id === groupId);
      state.groups[idx] = { ...state.groups[idx], ...payload, updated_at: new Date().toISOString() };
      renderGroups();
      const { id, ...patch } = payload;
      state.groups[idx] = await api(`/api/groups/${groupId}`, { method: "PATCH", body: JSON.stringify(patch) });
    } else {
      const temp = { ...payload, id: groupId || `saving-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.groups.unshift(temp);
      renderGroups();
      const created = await api("/api/groups", { method: "POST", body: JSON.stringify(payload) });
      state.groups = state.groups.map((group) => group.id === temp.id ? created : group);
    }
    $("groupForm").reset();
    renderReferenceControls();
    renderGroups();
  } catch (error) { state.groups = prev; renderGroups(); alert(error.message); }
});

$("copySnippetBtn").addEventListener("click", () => navigator.clipboard.writeText($("snippetCode").textContent));
$("copyRegisterSnippetBtn").addEventListener("click", () => navigator.clipboard.writeText($("registerSnippet").textContent));

$("leadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const session = await fetch("/api/chat/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site_id: state.currentSiteId, name: $("testName").value, email: $("testEmail").value, phone: $("testPhone").value }) }).then((r) => r.json());
  state.sessionId = session.id;
  addMessage("bot", `Session started for ${currentSite()?.name || state.currentSiteId}.`);
  $("leadForm").classList.add("hidden");
  $("testForm").classList.remove("hidden");
});

$("testForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = $("testQuestion").value.trim();
  if (!question) return;
  addMessage("user", question);
  $("testQuestion").value = "";
  const bot = addMessage("bot", "Thinking...");
  try {
    const response = await fetch("/api/chat/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site_id: state.currentSiteId, session_id: state.sessionId, question }) }).then((r) => r.json());
    bot.querySelector(".msg-text").textContent = response.answer;
    refreshLogs();
  } catch { bot.querySelector(".msg-text").textContent = "Sorry, something went wrong."; }
});
>>>>>>> dev

document.getElementById('cancel-group-btn').onclick = () => document.getElementById('group-editor').classList.add('hidden');

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
