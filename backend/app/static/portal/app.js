const TESTER_SESSIONS_KEY = "portal:testerSessions";
const TESTER_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function loadTesterSessions() {
  try {
    const stored = JSON.parse(localStorage.getItem(TESTER_SESSIONS_KEY) || "{}");
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(stored).filter(([, session]) => (
        session && session.updatedAt && now - session.updatedAt < TESTER_SESSION_TTL_MS
      ))
    );
  } catch {
    return {};
  }
}

function saveTesterSessions() {
  localStorage.setItem(TESTER_SESSIONS_KEY, JSON.stringify(state.testerSessions));
}

const state = { sites: [], groups: [], faqs: [], logs: [], currentSiteId: "", currentGroupId: "", sessionId: "", principal: null, charts: {}, currentAliases: [], logPage: 0, logLimit: 15, testerSessions: loadTesterSessions() };
const $ = (id) => document.getElementById(id);

const Cache = {
  get: (key) => {
    try {
      const item = localStorage.getItem(`cache:${key}`);
      if (!item) return null;
      const { data, expiry } = JSON.parse(item);
      if (Date.now() > expiry) {
        localStorage.removeItem(`cache:${key}`);
        return null;
      }
      return data;
    } catch { return null; }
  },
  set: (key, data, ttl = 600000) => { // Default 10 mins
    localStorage.setItem(`cache:${key}`, JSON.stringify({ data, expiry: Date.now() + ttl }));
  },
  remove: (key) => localStorage.removeItem(`cache:${key}`),
  clear: () => {
    Object.keys(localStorage).forEach(k => k.startsWith('cache:') && localStorage.removeItem(k));
  }
};

const SELECTION_KEY = "portal:selectedContext";

const firebaseConfig = {
  apiKey: "AIzaSyC1QxlKBkLpT2htParIuodhPNX6qtTGnlU",
  authDomain: "chatbot-faq-76909.firebaseapp.com",
  projectId: "chatbot-faq-76909",
};

let portalApp;
try { portalApp = firebase.initializeApp(firebaseConfig, "PortalApp"); } catch { portalApp = firebase.app("PortalApp"); }
const auth = firebase.auth(portalApp);

// Check for session hint before anything else to prevent flickering
if (!localStorage.getItem("portal_session") && !new URLSearchParams(window.location.search).has("handoff")) {
  showLogin();
}

(async () => {
  await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      try {
        localStorage.setItem("portal_session", await user.getIdToken());
        $("userEmail").textContent = user.email;
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
      throw new Error(detail ? `Session rejected: ${detail}` : "Session rejected. Sign out and sign in again.");
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
    return typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data);
  } catch {
    return bodyText;
  }
}

function showLogin() { $("loginOverlay").classList.add("active"); $("mainLayout").style.display = "none"; }


function hideLogin() { $("loginOverlay").classList.remove("active"); $("mainLayout").style.display = "grid"; }
function setStatus(text) { $("statusText").textContent = text; }
function setLoading(on) { $("globalLoading").style.display = on ? "flex" : "none"; }
function esc(v = "") { return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function formatDate(value) { return value ? new Date(value).toLocaleString() : "n/a"; }
function formatTime(value) { return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "n/a"; }
function recentStamp(record) {
  const created = record.created_at ? new Date(record.created_at).getTime() : 0;
  const updated = record.updated_at ? new Date(record.updated_at).getTime() : 0;
  return updated && updated > created + 1000 ? `Updated ${formatDate(record.updated_at)}` : `Created ${formatDate(record.created_at)}`;
}

function showToast(message, type = "info", duration = 3000) {
  const container = $("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  let content = `<span>${message}</span>`;
  if (type === "loading") content += `<div class="toast-spinner"></div>`;
  toast.innerHTML = content;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  if (type !== "loading" && duration > 0) {
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  return {
    close: () => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    },
    update: (newMessage, newType) => {
      toast.className = `toast ${newType}`;
      toast.innerHTML = `<span>${newMessage}</span>${newType === "loading" ? '<div class="toast-spinner"></div>' : ""}`;
    }
  };
}

function finishToast(toast, message, type = "success", duration = 2500) {
  if (!toast) return showToast(message, type, duration);
  toast.update(message, type);
  setTimeout(() => toast.close(), duration);
  return toast;
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
function currentGroup() { return state.groups.find((group) => group.id === state.currentGroupId); }
function isSiteMode() { return $("toggleSitesBtn")?.classList.contains("active") !== false; }
function currentContextKey() { return isSiteMode() ? `site:${state.currentSiteId}` : `group:${state.currentGroupId}`; }
function currentContextParams() {
  const params = new URLSearchParams();
  if (isSiteMode() && state.currentSiteId) params.set("site_id", state.currentSiteId);
  if (!isSiteMode() && state.currentGroupId) params.set("group_id", state.currentGroupId);
  return params;
}

function contextDisplayName() {
  return isSiteMode()
    ? (currentSite()?.name || state.currentSiteId || "site")
    : (currentGroup()?.name || state.currentGroupId || "group");
}

function saveSelectedContext() {
  const mode = isSiteMode() ? "site" : "group";
  const id = mode === "site" ? state.currentSiteId : state.currentGroupId;
  if (id) {
    localStorage.setItem(SELECTION_KEY, JSON.stringify({
      mode,
      id,
      siteId: state.currentSiteId,
      groupId: state.currentGroupId,
    }));
  }
}

function restoreSelectedContext(params = new URLSearchParams()) {
  const siteId = params.get("site_id");
  if (siteId && state.sites.some((site) => site.id === siteId)) {
    state.currentSiteId = siteId;
    $("toggleSitesBtn")?.classList.add("active");
    $("toggleGroupsBtn")?.classList.remove("active");
    saveSelectedContext();
    return;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) || "null");
    const savedSiteId = saved?.siteId || (saved?.mode === "site" ? saved.id : "");
    const savedGroupId = saved?.groupId || (saved?.mode === "group" ? saved.id : "");
    if (savedSiteId && state.sites.some((site) => site.id === savedSiteId)) {
      state.currentSiteId = savedSiteId;
    }
    if (savedGroupId && state.groups.some((group) => group.id === savedGroupId)) {
      state.currentGroupId = savedGroupId;
    }
    if (saved?.mode === "group" && state.currentGroupId) {
      $("toggleGroupsBtn")?.classList.add("active");
      $("toggleSitesBtn")?.classList.remove("active");
      return;
    }
    if (saved?.mode === "site" && state.currentSiteId) {
      $("toggleSitesBtn")?.classList.add("active");
      $("toggleGroupsBtn")?.classList.remove("active");
      return;
    }
  } catch {}

  if (!state.currentSiteId && !state.currentGroupId && state.sites.length) {
    state.currentSiteId = state.sites[0].id;
    $("toggleSitesBtn")?.classList.add("active");
    $("toggleGroupsBtn")?.classList.remove("active");
  }
}

function clearCurrentContextCache() {
  const contextKey = currentContextKey();
  ["faqs", "logs", "analytics"].forEach((type) => Cache.remove(`${type}:${contextKey}`));
}

function renderFaqLoading() {
  if ($("faqsList")) $("faqsList").innerHTML = `<div class="empty-state"><i data-lucide="loader"></i><p>Retrieving knowledge base...</p></div>`;
  lucide.createIcons();
}

function renderLogLoading() {
  if ($("logsList")) $("logsList").innerHTML = `<div class="empty-state"><i data-lucide="loader"></i><p>Retrieving conversation logs...</p></div>`;
  if ($("recentActivityTable")) $("recentActivityTable").innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center;padding:40px;">Retrieving activity...</td></tr>';
  lucide.createIcons();
}

async function bootstrapPortal() {
  // 1. Try immediate render from cache for "smooth" feel
  const cachedMe = Cache.get("me");
  const cachedSites = Cache.get("sites");
  const cachedGroups = Cache.get("groups");

  if (cachedMe && cachedSites && cachedGroups) {
    state.principal = cachedMe;
    state.sites = cachedSites;
    state.groups = cachedGroups;
    if (state.sites.length) {
      const params = new URLSearchParams(window.location.search);
      restoreSelectedContext(params);
      
      // Determine initial tab from URL hash or default to analytics
      const initialTab = window.location.hash.replace('#', '') || 'analytics';
      switchTab(initialTab);

      renderReferenceControls();
      syncSelectionBar();
      renderGroups();
      prefillSettings();
      renderSnippet();
      
      // Load cached secondary data
      const contextKey = currentContextKey();
      state.faqs = Cache.get(`faqs:${contextKey}`) || [];
      state.logs = Cache.get(`logs:${contextKey}`) || [];
      const cachedAnalytics = Cache.get(`analytics:${contextKey}`);

      if (state.faqs.length) renderFaqs();
      if (state.logs.length) { renderLogs(); renderRecentActivity(); }
      if (cachedAnalytics) renderAnalytics(cachedAnalytics);
      
      setStatus("System Ready (Cached)");
      lucide.createIcons();
    }
  }

  // 2. Fetch fresh data
  setStatus("Syncing data...");
  try {
    const [me, sites, groups] = await Promise.all([api("/api/me"), api("/api/sites"), api("/api/groups")]);
    Cache.set("me", me);
    Cache.set("sites", sites);
    Cache.set("groups", groups);

    state.principal = me;
    state.sites = sites;
    state.groups = groups;

    if (!state.sites.length) return showNoAccess();
    const params = new URLSearchParams(window.location.search);
    restoreSelectedContext(params);
    
    renderReferenceControls();
    syncSelectionBar();
    renderGroups();
    
    await refreshContextData();
    prefillSettings();
    renderSnippet();
    setStatus("System Ready");
    lucide.createIcons();
  } catch (error) {
    console.error("Bootstrap failed", error);
    if (!state.sites.length) setStatus("Sync failed. Please check connection.");
  }
}

function showNoAccess() {
  $("mainLayout").style.display = "grid";
  document.querySelector(".main-content").innerHTML = `<div class="no-access"><h2>No Site Access</h2><p>Create a site from registration or contact support.</p></div>`;
}

function renderReferenceControls() {
  $("siteOptions").innerHTML = state.sites.map((site) => `<option value="${esc(siteDisplay(site))}"></option>`).join("");
  $("groupOptions").innerHTML = state.groups.map((group) => `<option value="${esc(groupDisplay(group))}"></option>`).join("");

  const multiSite = state.sites.length > 1;
  const hasGroups = state.groups.length > 0;

  // 1. contextToggle (Site/Group toggle): Only show if user has both multiple sites AND at least one group
  $("contextToggle").style.display = (multiSite && hasGroups) ? "" : "none";
  
  // 2. selectionArea (Selected Site/Group name and Switch button): Show if user has multiple sites
  $("selectionArea").style.display = multiSite ? "" : "none";
  
  // 3. groupsTab (Sidebar navigation item): Show if user has multiple sites (so they can create groups)
  $("groupsTab").style.display = multiSite ? "flex" : "none";
  
  // Ensure the toggle button for groups inside the toggle area is also tied to existence of groups
  $("toggleGroupsBtn").style.display = (multiSite && hasGroups) ? "" : "none";

  if (!hasGroups && !isSiteMode()) {
    $("toggleSitesBtn")?.classList.add("active");
    $("toggleGroupsBtn")?.classList.remove("active");
  }
  if (!state.currentSiteId && state.sites.length) state.currentSiteId = state.sites[0].id;
}

function syncSelectionBar() {
  // For single-site users, skip all selection UI — just update tester name
  if (state.sites.length <= 1) {
    $("testerSiteName").textContent = currentSite()?.name || "Support Assistant";
    return;
  }

  const siteMode = isSiteMode();
  const currentId = siteMode ? state.currentSiteId : state.currentGroupId;
  const selected = siteMode ? currentSite() : currentGroup();
  $("toggleSitesBtn")?.classList.toggle("active", siteMode);
  $("toggleGroupsBtn")?.classList.toggle("active", !siteMode);
  if (!currentId) {
    $("noSelectionPrompt").classList.remove("hidden");
    $("selectionBar").classList.add("hidden");
    $("initialSelectBtn").textContent = siteMode ? "Select Site" : "Select Group";
  } else {
    $("noSelectionPrompt").classList.add("hidden");
    $("selectionBar").classList.remove("hidden");
    $("selectionLabel").textContent = siteMode ? "Selected Site" : "Selected Group";
    $("selectedName").textContent = selected?.name || currentId;
  }
  $("testerSiteName").textContent = currentSite()?.name || "No site selected";
  saveSelectedContext();
}

function selectSite(siteId) {
  state.currentSiteId = siteId;
  state.sessionId = "";
  $("toggleSitesBtn").classList.add("active");
  $("toggleGroupsBtn").classList.remove("active");
  state.logPage = 0;
  syncSelectionBar();
  $("testMessages").innerHTML = "";
  const activeTab = document.querySelector(".nav-item.active")?.dataset.tab;
  if (activeTab === "tester") loadTesterSession();
  refreshContextData();
  prefillSettings();
  renderSnippet();
}

function selectGroup(groupId) {
  state.currentGroupId = groupId;
  state.sessionId = "";
  $("toggleGroupsBtn").classList.add("active");
  $("toggleSitesBtn").classList.remove("active");
  state.logPage = 0;
  syncSelectionBar();
  $("testMessages").innerHTML = "";
  refreshContextData();
  prefillSettings();
  renderSnippet();
}

async function refreshContextData({ force = false } = {}) {
  if (force) clearCurrentContextCache();
  setStatus(`${force ? "Refreshing" : "Loading"} ${contextDisplayName()}...`);
  await refreshAnalytics({ force });
  await Promise.all([refreshFaqs({ force }), refreshLogs({ force })]);
  setStatus("System Ready");
}

function openSelectionModal() {
  const siteMode = isSiteMode();
  $("selectionModalTitle").textContent = siteMode ? "Select Site" : "Select Group";
  $("selectionSearch").value = "";
  renderSelectionList();
  $("selectionModal").showModal();
}

function renderSelectionList() {
  const siteMode = isSiteMode();
  const query = $("selectionSearch").value.trim().toLowerCase();
  let items = siteMode ? state.sites : state.groups;
  if (query) {
    items = items.filter((item) => [item.name, item.id, item.domain, item.description].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  }
  const currentId = siteMode ? state.currentSiteId : state.currentGroupId;
  $("selectionList").innerHTML = items.length
    ? items.map((item) => `
      <div class="selection-item ${item.id === currentId ? "active" : ""}" onclick="handleSelectionClick('${esc(item.id)}')">
        <div>
          <strong>${esc(item.name)}</strong>
          <p class="muted">${esc(item.id)}</p>
        </div>
      </div>`).join("")
    : `<div class="empty-state"><p>No ${siteMode ? "sites" : "groups"} found.</p></div>`;
  lucide.createIcons();
}

window.handleSelectionClick = function handleSelectionClick(id) {
  if (isSiteMode()) selectSite(id);
  else selectGroup(id);
  $("selectionModal").close();
};

async function refreshFaqs({ force = false } = {}) {
  const params = currentContextParams();
  if (!params.toString()) {
    state.faqs = [];
    renderFaqs();
    return;
  }
  // Show cached version immediately
  const contextKey = currentContextKey();
  const cached = force ? null : Cache.get(`faqs:${contextKey}`);
  if (cached) { state.faqs = cached; renderFaqs(); }
  else { state.faqs = []; renderFaqLoading(); setStatus(`Retrieving FAQs for ${contextDisplayName()}...`); }

  try {
    state.faqs = await api(`/api/faqs?${params.toString()}`);
    Cache.set(`faqs:${contextKey}`, state.faqs);
    renderFaqs();
  } catch (error) { console.error("FAQ refresh failed", error); }
}

function renderFaqs() {
  const query = $("faqSearch").value.trim().toLowerCase();
  const faqs = state.faqs.filter((faq) => !query || [faq.question, faq.answer, faq.id, ...(faq.aliases || [])].some((value) => String(value || "").toLowerCase().includes(query)));
  
  if ($("faqFilteredCount")) {
    $("faqFilteredCount").textContent = faqs.length;
  }
  
  if (!faqs.length) {
    $("faqsList").innerHTML = `<div class="empty-state"><i data-lucide="help-circle"></i><p>No knowledge base entries found.</p></div>`;
    lucide.createIcons();
    return;
  }

  $("faqsList").innerHTML = faqs.map((faq) => `
    <div class="faq-row animate-up" id="faq-${faq.id}">
      <div class="faq-card-content">
        <div class="faq-card-header">
          <div class="faq-content-left">
            <span class="faq-question">${esc(faq.question)}</span>
            <div class="faq-meta">
              ${faq.group_id ? `<span class="meta-item"><i data-lucide="layers"></i> Group: ${esc(state.groups.find(g => g.id === faq.group_id)?.name || 'Unknown')}</span>` : ''}
            </div>
          </div>
          <div class="faq-content-right">
            <span class="meta-item"><i data-lucide="clock"></i> ${recentStamp(faq)}</span>
          </div>
        </div>
        <div class="faq-card-body">
          <p class="faq-answer">${esc(faq.answer)}</p>
          ${faq.aliases?.length ? `
            <div class="faq-alias-summary" onclick="editFaq('${esc(faq.id)}')" title="Click to view variations">
              <i data-lucide="copy"></i>
              <span>Alias: ${faq.aliases.length}</span>
            </div>
          ` : ''}
          
          <div class="faq-actions-row">
            <button class="action-btn-pill" data-action="edit" data-id="${esc(faq.id)}" title="Edit Entry">
              <i data-lucide="edit-3"></i>
              <span>Edit</span>
            </button>
            <button class="action-btn-pill delete" data-action="delete" data-id="${esc(faq.id)}" title="Delete Entry">
              <i data-lucide="trash-2"></i>
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>`).join("");
    
  lucide.createIcons();
}

async function refreshLogs({ force = false } = {}) {
  const contextParams = currentContextParams();
  if (!contextParams.toString()) {
    state.logs = [];
    state.logTotal = 0;
    renderLogs();
    renderRecentActivity();
    return;
  }
  // Show cached version immediately if on first page
  const contextKey = currentContextKey();
  if (state.logPage === 0) {
    const cached = force ? null : Cache.get(`logs:${contextKey}`);
    if (cached) { state.logs = cached; renderLogs(); renderRecentActivity(); }
    else { state.logs = []; renderLogLoading(); setStatus(`Retrieving logs for ${contextDisplayName()}...`); }
  }

  const offset = state.logPage * state.logLimit;
  const p = currentContextParams();
  p.set("limit", String(state.logLimit));
  p.set("offset", String(offset));
  if ($("logTypeFilter").value) p.set("response_type", $("logTypeFilter").value);
  if ($("logDateFilter").value) p.set("since", $("logDateFilter").value);
  
  $("prevLogPage").disabled = true;
  $("nextLogPage").disabled = true;
  
  try {
    const res = await api(`/api/logs?${p.toString()}`);
    state.logs = res.logs || [];
    state.logTotal = res.total || 0;
    
    if (state.logPage === 0) Cache.set(`logs:${contextKey}`, state.logs);
    
    // Update total count UI
    if ($("logTotalCount")) $("logTotalCount").textContent = state.logTotal;
    
    renderLogs();
    renderRecentActivity();
    
    // Update pagination UI
    $("logPageIndicator").textContent = `Page ${state.logPage + 1}`;
    $("prevLogPage").disabled = state.logPage === 0;
    $("nextLogPage").disabled = (offset + state.logLimit) >= state.logTotal;
  } catch (error) { console.error("Logs refresh failed", error); }
}

function renderLogs() {
  const logs = state.logs;
  
  if (!logs.length) {
    $("logsList").innerHTML = `<div class="empty-state"><i data-lucide="list-filter"></i><p>No activity logs found for this period.</p></div>`;
    lucide.createIcons();
    return;
  }

  $("logsList").innerHTML = logs.map((log) => `
    <div class="log-row animate-up">
      <div class="log-status-col">
        <span class="status-indicator status-${log.response_type === 'faq_hit' ? 'hit' : log.response_type === 'llm_fallback' ? 'fallback' : 'helpline'}"></span>
      </div>
      <div class="log-body-col">
        <div class="log-header">
          <div class="log-title">
            <h3 class="log-question">${esc(log.question)}</h3>
            <div class="log-pills">
              <span class="status-pill status-${log.response_type === 'faq_hit' ? 'hit' : log.response_type === 'llm_fallback' ? 'fallback' : 'helpline'}">
                ${esc(log.response_type.replaceAll("_", " "))}
              </span>
              ${log.vector_distance != null ? `
                <span class="distance-pill" title="Vector distance (lower is closer)">
                  <i data-lucide="target" style="width:12px;height:12px;margin-right:4px;"></i>
                  ${log.vector_distance.toFixed(4)}
                </span>
              ` : ''}
            </div>
          </div>
          <div class="log-meta">
            <span class="meta-item"><i data-lucide="user"></i> ${esc(log.user_name || log.email || 'Anonymous')}</span>
            <span class="meta-item"><i data-lucide="clock"></i> ${formatDate(log.timestamp)}</span>
            <button class="secondary-btn btn-sm" onclick="convertLog('${esc(log.id)}')" style="margin-left: 8px;">
              <i data-lucide="plus-circle"></i>
              <span>FAQ</span>
            </button>
          </div>
        </div>
        <div class="log-content">
          <p class="log-answer">${esc(log.answer)}</p>
        </div>
      </div>
    </div>`).join("");
    
  lucide.createIcons();
  renderRecentActivity();
}

function renderRecentActivity() {
  const latest = state.logs.slice(0, 10);
  $("recentActivityTable").innerHTML = latest.length ? latest.map(log => `
    <tr>
      <td>
        <div style="font-weight: 600;">${formatTime(log.timestamp)}</div>
        <div class="muted" style="font-size: 11px;">${new Date(log.timestamp).toLocaleDateString()}</div>
      </td>
      <td>
        <div style="font-weight: 600;">${esc(log.response_type === 'faq_hit' ? 'FAQ Answered' : log.response_type === 'llm_fallback' ? 'Legacy Fallback' : 'Helpline Escaped')}</div>
        ${log.vector_distance != null ? `
          <div class="distance-pill pill-xs" style="margin-top: 4px;">
            ${log.vector_distance.toFixed(3)}
          </div>
        ` : ''}
      </td>
      <td>
        <div class="muted" style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${esc(log.question)}
        </div>
      </td>
      <td>
        <span class="status-badge status-${log.response_type === 'faq_hit' ? 'hit' : log.response_type === 'llm_fallback' ? 'fallback' : 'helpline'}">
          ${esc(log.response_type === 'faq_hit' ? 'Answered' : log.response_type === 'llm_fallback' ? 'Legacy' : 'Escaped')}
        </span>
      </td>
    </tr>
  `).join("") : '<tr><td colspan="4" class="muted" style="text-align: center; padding: 40px;">No recent activity</td></tr>';
}

async function refreshAnalytics({ force = false } = {}) {
  const contextParams = currentContextParams();
  if (!contextParams.toString()) {
    renderAnalytics({ total_queries: 0, hit_rate: 0, faq_hits: 0, llm_rate: 0, llm_fallbacks: 0, helpline_rate: 0 });
    return;
  }
  // Show cached version immediately
  const contextKey = currentContextKey();
  const cached = force ? null : Cache.get(`analytics:${contextKey}`);
  if (cached) renderAnalytics(cached);
  else {
    renderAnalytics({ total_queries: 0, hit_rate: 0, faq_hits: 0, llm_rate: 0, llm_fallbacks: 0, helpline_rate: 0 });
    setStatus(`Retrieving analytics for ${contextDisplayName()}...`);
  }

  try {
    const data = isSiteMode()
      ? await api(`/api/sites/${state.currentSiteId}/analytics`)
      : await api(`/api/groups/${state.currentGroupId}/analytics`);
    Cache.set(`analytics:${contextKey}`, data);
    renderAnalytics(data);
  } catch (error) { console.error("Analytics refresh failed", error); }
}

function renderAnalytics(data) {
  $("statTotal").textContent = data.total_queries;
  $("statHitRate").textContent = `${data.hit_rate}%`;
  $("statFaqHits").textContent = `${data.faq_hits} hits`;
  $("statLlmRate").textContent = `${data.llm_rate}%`;
  $("statLlmHits").textContent = `${data.llm_fallbacks} fallbacks`;
  $("statHelplineRate").textContent = `${data.helpline_rate}%`;
  
  renderMainCharts(data);
  renderSparklines();
}

function renderMainCharts(data) {
  // Mock data for queries over time since backend doesn't provide daily breakdown yet
  const labels = ['May 8', 'May 9', 'May 10', 'May 11', 'May 12', 'May 13', 'May 14'];
  const values = [1, 0, 1, 1, 1, 0, 2]; // Match image

  if (state.charts.main) state.charts.main.destroy();
  const ctx = $('queriesChart').getContext('2d');
  state.charts.main = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Queries',
        data: values,
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124, 58, 237, 0.1)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#7c3aed',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { stepSize: 1 } },
        x: { grid: { display: false } }
      }
    }
  });

  if (state.charts.donut) state.charts.donut.destroy();
  const donutCtx = $('breakdownChart').getContext('2d');
  state.charts.donut = new Chart(donutCtx, {
    type: 'doughnut',
    data: {
      labels: ['FAQ Hit', 'Legacy Fallback', 'Helpline'],
      datasets: [{
        data: [data.faq_hits, data.llm_fallbacks, Math.round(data.total_queries * data.helpline_rate / 100)],
        backgroundColor: ['#10b981', '#ea580c', '#2563eb'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } }
      }
    }
  });
}

function renderSparklines() {
  ['sparklineTotal', 'sparklineHits', 'sparklineLlm', 'sparklineHelpline'].forEach(id => {
    if (state.charts[id]) state.charts[id].destroy();
    const ctx = $(id).getContext('2d');
    const color = id.includes('Total') ? '#7c3aed' : id.includes('Hits') ? '#10b981' : id.includes('Llm') ? '#ea580c' : '#2563eb';
    state.charts[id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [1, 2, 3, 4, 5, 6, 7],
        datasets: [{
          data: [2, 5, 3, 8, 4, 9, 6].map(v => v + Math.random() * 5),
          borderColor: color,
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } }
      }
    });
  });
}

function renderGroups() {
  $("groupSiteChecks").innerHTML = state.sites.map((site) => `<label class="checkbox-label"><input name="groupSite" type="checkbox" value="${esc(site.id)}" /> <span>${esc(site.name)}</span></label>`).join("");
  const q = $("groupSearch").value.trim().toLowerCase();
  const groups = state.groups.filter((group) => !q || [group.name, group.id, group.description].some((value) => String(value || "").toLowerCase().includes(q)));
  
  if (!groups.length) {
    $("groupsList").innerHTML = `<div class="empty-state"><i data-lucide="layers"></i><p>No site groups found.</p></div>`;
    lucide.createIcons();
    return;
  }

  $("groupsList").innerHTML = `<div class="groups-grid">` + groups.map((group) => {
    const sites = group.site_ids.map((id) => state.sites.find((site) => site.id === id)?.name || id);
    return `
      <div class="group-card animate-up">
        <div class="group-card-header">
          <div class="group-card-title">
            <div class="group-icon-circle">
              <i data-lucide="layers"></i>
            </div>
            <h3>${esc(group.name)}</h3>
          </div>
          <div class="group-actions">
            <button onclick="editGroup('${esc(group.id)}')" class="action-btn-pill" title="Edit Group">
              <i data-lucide="edit-3"></i>
            </button>
            <button onclick="deleteGroup('${esc(group.id)}')" class="action-btn-pill delete" title="Delete Group">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
        <p class="group-description">${esc(group.description || 'No description provided for this group.')}</p>
        <div class="group-sites-section">
          <span class="sites-label">Associated Sites</span>
          <div class="sites-list">
            ${sites.map(name => `<span class="site-tag">${esc(name)}</span>`).join('')}
            ${!sites.length ? '<span class="muted" style="font-size:12px;">No sites linked</span>' : ''}
          </div>
        </div>
      </div>`;
  }).join("") + `</div>`;
  
  if ($("groupCount")) $("groupCount").textContent = groups.length;
  lucide.createIcons();
}

function selectedCheckboxValues(name) { return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value); }

function prefillSettings() {
  const site = currentSite();
  if (!site) {
    $("settingsForm")?.reset();
    if ($("snippetCode")) $("snippetCode").textContent = "Select a site to configure widget settings.";
    return;
  }
  $("setName").value = site.name || "";
  $("setDomain").value = site.domain || "";
  $("setHelpline").value = site.helpline_number || "";
  $("setWelcome").value = site.welcome_message || "";
  $("setFallback").value = site.fallback_message || "";
  $("setAcceptDist").value = site.faq_accept_distance ?? "";
  $("setReviewDist").value = site.faq_review_distance ?? "";
  $("setCandidateDist").value = site.llm_candidate_distance ?? "";
  $("setOrigins").value = (site.allowed_origins || []).join(", ");
  $("setPrimaryColor").value = site.primary_color || "#4f46e5";
  $("setPrimaryHex").value = site.primary_color || "#4f46e5";
  $("setBotName").value = site.bot_name || "";
  $("setBotAvatar").value = site.bot_avatar_url || "";
  $("setLauncher").value = site.launcher_icon || "?";
  $("setActive").checked = site.active !== false;
}

function renderSnippet(targetId = "snippetCode") {
  if (!state.currentSiteId && targetId === "snippetCode") {
    $(targetId).textContent = "Select a site to generate the widget snippet.";
    return;
  }
  const origin = window.location.origin;
  const siteId = targetId === "snippetCode" ? state.currentSiteId : state.lastRegisteredSiteId;
  $(targetId).textContent = `<!-- FAQ Chatbot Widget -->\n<script src="${origin}/widget/chatbot-widget.js" data-site-id="${siteId}" data-api-base="${origin}"></script>`;
}

function renderAliasTags() {
  $("aliasTagsList").innerHTML = state.currentAliases.map((alias, index) => `
    <div class="alias-list-item">
      <span class="alias-content">${index + 1}. ${esc(alias)}</span>
      <button type="button" class="alias-delete-x" onclick="window.removeAlias(${index})" aria-label="Remove alias">X</button>
      <div style="clear: both;"></div>
    </div>
  `).join("");
}

window.removeAlias = function(index) {
  state.currentAliases.splice(index, 1);
  renderAliasTags();
};

function addAlias() {
  const val = $("newAliasInput").value.trim();
  if (val && !state.currentAliases.includes(val)) {
    state.currentAliases.push(val);
    $("newAliasInput").value = "";
    renderAliasTags();
  }
}

function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = (el.scrollHeight) + "px";
}

window.editFaq = function editFaq(faqId) {
  const faq = state.faqs.find((item) => item.id === faqId);
  if (!faq) return;
  $("faqModalTitle").textContent = "Edit FAQ";
  $("faqId").value = faq.id;
  $("faqQuestion").value = faq.question;
  state.currentAliases = [...(faq.aliases || [])];
  renderAliasTags();
  $("faqAnswer").value = faq.answer;
  autoGrow($("faqQuestion"));
  autoGrow($("faqAnswer"));
  $("faqTargetGroup").value = faq.group_id ? groupDisplay(state.groups.find((group) => group.id === faq.group_id)) : "";
  $("faqModal").showModal();
};

let faqQueue = Promise.resolve();
const faqIdMap = {};

function resolveFaqId(id) {
  return faqIdMap[id] || id;
}

window.deleteFaq = async function deleteFaq(faqId) {
  const faqIndex = state.faqs.findIndex((faq) => faq.id === faqId);
  if (faqIndex === -1) return;
  const backupFaq = state.faqs[faqIndex];

  // Optimistic UI: remove immediately
  state.faqs.splice(faqIndex, 1);
  renderFaqs();

  faqQueue = faqQueue.then(async () => {
    const realId = resolveFaqId(faqId);
    // If it's still a temporary ID, it means the creation task failed and rolled back.
    if (realId.startsWith("temp_")) return; 
    
    try { 
      await api(`/api/faqs/${realId}`, { method: "DELETE" }); 
      refreshAnalytics();
    } catch (error) { 
      // Revert on failure
      const exists = state.faqs.some(f => f.id === faqId || f.id === realId);
      if (!exists) {
        state.faqs.unshift(backupFaq);
        renderFaqs();
      }
      alert("Failed to delete FAQ: " + error.message); 
    }
  });
};

window.convertLog = function convertLog(logId) {
  const log = state.logs.find((item) => item.id === logId);
  if (!log) return;

  // Reset modal state
  $("faqModalTitle").textContent = "Convert Log to FAQ";
  $("faqId").value = "";
  $("faqQuestion").value = "";
  $("faqAnswer").value = "";
  state.currentAliases = [];
  $("faqTargetGroup").value = "";

  const type = log.response_type; // 'faq_hit', 'llm_fallback', 'helpline'

  if (type === 'helpline') {
    $("faqQuestion").value = log.question;
  } else if (type === 'llm_fallback') {
    $("faqQuestion").value = log.question;
    $("faqAnswer").value = log.answer;
  } else if (type === 'faq_hit' && log.matched_faq_id) {
    const faq = state.faqs.find(f => f.id === log.matched_faq_id);
    if (faq) {
      $("faqModalTitle").textContent = "Add Alias to FAQ";
      $("faqId").value = faq.id;
      $("faqQuestion").value = faq.question;
      $("faqAnswer").value = faq.answer;
      state.currentAliases = [...faq.aliases];
      if (!state.currentAliases.includes(log.question)) {
          state.currentAliases.push(log.question);
      }
      const groupName = state.groups.find(g => g.id === faq.group_id)?.name || "";
      $("faqTargetGroup").value = groupName;
    } else {
      $("faqQuestion").value = log.question;
    }
  }
  renderAliasTags();
  autoGrow($("faqQuestion"));
  autoGrow($("faqAnswer"));

  $("faqModal").showModal();
};

window.editGroup = function editGroup(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  $("groupId").value = group.id;
  $("groupName").value = group.name;
  $("groupDescription").value = group.description || "";
  document.querySelectorAll("input[name='groupSite']").forEach((input) => input.checked = group.site_ids.includes(input.value));
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

let groupQueue = Promise.resolve();

window.deleteGroup = async function deleteGroup(groupId) {
  if (!confirm("Delete this group?")) return;
  
  const groupIndex = state.groups.findIndex((g) => g.id === groupId);
  if (groupIndex === -1) return;
  const backupGroup = state.groups[groupIndex];

  // Optimistic UI: remove immediately
  state.groups.splice(groupIndex, 1);
  renderReferenceControls();
  renderGroups();

  groupQueue = groupQueue.then(async () => {
    try { 
      await api(`/api/groups/${groupId}`, { method: "DELETE" }); 
      Cache.set("groups", state.groups);
    } catch (error) { 
      // Revert on failure
      if (!state.groups.some(g => g.id === groupId)) {
        state.groups.splice(groupIndex, 0, backupGroup);
        renderReferenceControls();
        renderGroups();
      }
      alert("Failed to delete group: " + error.message); 
    }
  });
};

function switchTab(tabId) {
  const titles = {
    analytics: ["Analytics", "Overview of your chatbot performance and usage."],
    faqs: ["FAQs", "Manage your chatbot's knowledge base."],
    logs: ["Conversation Logs", "View and analyze customer interactions."],
    groups: ["Site Groups", "Manage groups of sites for shared FAQs."],
    tester: ["Bot Tester", "Try out your chatbot in a safe environment."],
    settings: ["Site Settings", "Configure your chatbot's behavior and appearance."]
  };

  // If invalid tab, fallback to analytics
  if (!titles[tabId]) tabId = 'analytics';

  document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabId));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active-panel", panel.id === tabId));
  
  // Update URL hash without jumping the page
  if (window.location.hash !== `#${tabId}`) {
    history.replaceState(null, null, `#${tabId}`);
  }
  
  if (titles[tabId]) {
    $("panelTitle").textContent = titles[tabId][0];
    $("panelSubtitle").textContent = titles[tabId][1];
  }
  
  if (tabId === "settings") { prefillSettings(); renderSnippet(); }
  if (tabId === "tester") { loadTesterSession(); }
  lucide.createIcons();
}

function loadTesterSession() {
  const sessionData = state.testerSessions[state.currentSiteId];
  if (sessionData && sessionData.id) {
    state.sessionId = sessionData.id;
    $("testMessages").innerHTML = "";
    sessionData.messages.forEach(msg => {
      addMessage(msg.type, msg.text, true);
    });
  } else {
    startTestingSession();
  }
}

function clearTesterSession() {
  if (state.currentSiteId && state.testerSessions[state.currentSiteId]) {
    delete state.testerSessions[state.currentSiteId];
    saveTesterSessions();
  }
  state.sessionId = "";
  $("testMessages").innerHTML = "";
  startTestingSession();
}

async function startTestingSession() {
  if (!state.currentSiteId) {
    $("testMessages").innerHTML = "";
    addMessage("bot", "Select a site to start a tester session.");
    return;
  }
  if (state.sessionId) return;
  try {
    const session = await api("/api/chat/sessions", { 
      method: "POST", 
      body: JSON.stringify({ 
        site_id: state.currentSiteId, 
        name: "Admin Tester", 
        email: "tester@internal.local", 
        phone: "" 
      }) 
    });
    state.sessionId = session.id;
    state.testerSessions[state.currentSiteId] = { id: session.id, messages: [], updatedAt: Date.now() };
    saveTesterSessions();
    $("testMessages").innerHTML = "";
    
    const welcome = currentSite()?.welcome_message || `Hello! I'm the assistant for ${currentSite()?.name || state.currentSiteId}. How can I help you today?`;
    addMessage("bot", welcome);
  } catch (error) { 
    console.error("Tester init failed", error);
    addMessage("bot", "Error: Could not start testing session.");
  }
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
$("closeRegisterBtn").addEventListener("click", () => {
  $("registerModal").close();
  $("registerForm").reset();
});
$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    email: $("regEmail").value.trim(),
    password: $("regPassword").value,
    site: {
      domain: $("regDomain").value.trim(),
    },
  };
  try {
    const result = await api("/api/register-site-owner", { method: "POST", body: JSON.stringify(payload) });
    state.lastRegisteredSiteId = result.site.id;
    
    // Close registration and show success
    $("registerModal").close();
    $("registerForm").reset();
    $("registerSuccessModal").showModal();
    renderSnippet("registerSuccessSnippet");
    
    // Continue login in background
    await auth.signInWithCustomToken(result.firebase_token);
  } catch (error) {
    if (error.message.includes("EMAIL_EXISTS")) {
      showToast("Account already exists. Please sign in.", "info", 5000);
      $("registerModal").close();
      $("registerForm").reset();
      $("loginEmail").value = payload.email;
      $("loginPassword").focus();
    } else {
      showToast(error.message, "error", 5000);
    }
  }
});

$("copySuccessSnippetBtn").addEventListener("click", () => {
  const code = $("registerSuccessSnippet").textContent;
  navigator.clipboard.writeText(code);
  const btn = $("copySuccessSnippetBtn");
  const icon = btn.querySelector("i");
  icon.setAttribute("data-lucide", "check");
  lucide.createIcons();
  setTimeout(() => {
    icon.setAttribute("data-lucide", "copy");
    lucide.createIcons();
  }, 2000);
});

$("logoutBtn").addEventListener("click", () => { 
  auth.signOut(); 
  localStorage.removeItem("portal_session"); 
  localStorage.removeItem(TESTER_SESSIONS_KEY);
  Cache.clear();
  showLogin(); 
});
$("toggleSitesBtn").addEventListener("click", () => {
  $("toggleSitesBtn").classList.add("active");
  $("toggleGroupsBtn").classList.remove("active");
  if (!state.currentSiteId && state.sites.length) state.currentSiteId = state.sites[0].id;
  state.logPage = 0;
  syncSelectionBar();
  refreshContextData();
  prefillSettings();
  renderSnippet();
});
$("toggleGroupsBtn").addEventListener("click", () => {
  if (!state.groups.length) return;
  $("toggleGroupsBtn").classList.add("active");
  $("toggleSitesBtn").classList.remove("active");
  if (!state.currentGroupId && state.groups.length) state.currentGroupId = state.groups[0].id;
  state.logPage = 0;
  syncSelectionBar();
  refreshContextData();
  prefillSettings();
  renderSnippet();
});
$("refreshContextBtn")?.addEventListener("click", () => refreshContextData({ force: true }));
$("openSwitchBtn").addEventListener("click", openSelectionModal);
$("initialSelectBtn").addEventListener("click", openSelectionModal);
$("closeSelectionModalBtn").addEventListener("click", () => $("selectionModal").close());
$("selectionSearch").addEventListener("input", renderSelectionList);
document.querySelectorAll(".nav-item").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
$("createFaqBtn").addEventListener("click", () => { 
  $("faqId").value = ""; 
  $("faqForm").reset(); 
  state.currentAliases = [];
  renderAliasTags();
  autoGrow($("faqQuestion"));
  autoGrow($("faqAnswer"));
  $("faqModalTitle").textContent = "Add FAQ"; 
  $("faqModal").showModal(); 
});
$("closeFaqModalBtn").addEventListener("click", () => $("faqModal").close());

$("faqsList").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === "edit") window.editFaq(id);
  if (action === "delete") window.deleteFaq(id);
});

$("clearFaqBtn").addEventListener("click", () => { 
  $("faqForm").reset(); 
  state.currentAliases = []; 
  renderAliasTags(); 
  autoGrow($("faqQuestion"));
  autoGrow($("faqAnswer"));
});

$("faqQuestion").addEventListener("input", (e) => autoGrow(e.target));
$("faqAnswer").addEventListener("input", (e) => autoGrow(e.target));

$("addAliasBtn").addEventListener("click", addAlias);
$("newAliasInput").addEventListener("keydown", (e) => { 
  if (e.key === "Enter") { 
    e.preventDefault(); 
    addAlias(); 
  } 
});
$("faqSearch").addEventListener("input", renderFaqs);
$("groupSearch").addEventListener("input", renderGroups);
$("logSearch").addEventListener("input", () => { state.logPage = 0; refreshLogs(); });
["logTypeFilter", "logDateFilter"].forEach((id) => $(id).addEventListener("change", () => { state.logPage = 0; refreshLogs(); }));

$("prevLogPage").addEventListener("click", (e) => {
  e.preventDefault();
  if (state.logPage > 0) {
    state.logPage--;
    refreshLogs();
  }
});

$("nextLogPage").addEventListener("click", (e) => {
  e.preventDefault();
  state.logPage++;
  refreshLogs();
});

$("addSiteBtn").addEventListener("click", () => $("siteModal").showModal());
$("closeSiteModalBtn").addEventListener("click", () => $("siteModal").close());

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.currentSiteId) {
    alert("Select a site before saving site settings.");
    return;
  }
  const payload = {
    name: $("setName").value.trim(),
    domain: $("setDomain").value.trim(),
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
  if ($("setReviewDist").value !== "") payload.faq_review_distance = Number($("setReviewDist").value);
  if ($("setCandidateDist").value !== "") payload.llm_candidate_distance = Number($("setCandidateDist").value);
  
  try {
    const updated = await api(`/api/sites/${state.currentSiteId}`, { method: "PATCH", body: JSON.stringify(payload) });
    const idx = state.sites.findIndex(s => s.id === state.currentSiteId);
    if (idx !== -1) state.sites[idx] = updated;
    syncSelectionBar();
    alert("Settings saved successfully");
  } catch (error) { alert(error.message); }
});

$("siteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    name: $("siteName").value.trim(),
    domain: $("siteDomain").value.trim(),
    helpline_number: $("siteHelpline").value.trim(),
    welcome_message: $("siteWelcome").value.trim() || "Hi, how can I help?",
    fallback_message: $("siteFallback").value.trim() || "I could not find the exact answer. Please contact our helpline.",
  };
  try {
    const created = await api("/api/sites", { method: "POST", body: JSON.stringify(payload) });
    
    // Force refresh Firebase token to get the newly added 'site_ids' claim
    if (auth.currentUser) {
      const newToken = await auth.currentUser.getIdToken(true);
      localStorage.setItem("portal_session", newToken);
    }
    
    // Update local principal cache
    state.principal = await api("/api/me");
    Cache.set("me", state.principal);
    
    state.sites.unshift(created);
    state.currentSiteId = created.id;
    $("siteModal").close();
    renderReferenceControls();
    syncSelectionBar();
    selectSite(created.id);
  } catch (error) { alert(error.message); }
});

$("faqForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const groupId = idFromChooser($("faqTargetGroup").value, state.groups) || (!isSiteMode() ? state.currentGroupId : "");
  const payload = {
    question: $("faqQuestion").value.trim(),
    answer: $("faqAnswer").value.trim(),
    aliases: [...state.currentAliases],
    site_id: groupId ? "" : state.currentSiteId,
    group_id: groupId || "",
    active: true,
  };
  const faqId = $("faqId").value.trim();
  
  // Optimistic UI: close modal immediately
  $("faqModal").close();

  if (faqId) {
    const faqIndex = state.faqs.findIndex(f => f.id === faqId);
    if (faqIndex === -1) return;
    const backupFaq = state.faqs[faqIndex];
    
    // Optimistic UI: update state and UI
    state.faqs[faqIndex] = { ...backupFaq, ...payload };
    renderFaqs();
    
    faqQueue = faqQueue.then(async () => {
      const realId = resolveFaqId(faqId);
      if (realId.startsWith("temp_")) return; // Creation failed previously, skip update
      try {
        const updated = await api(`/api/faqs/${realId}`, { method: "PATCH", body: JSON.stringify(payload) });
        const idx = state.faqs.findIndex(f => f.id === realId || f.id === faqId);
        if (idx !== -1) {
          state.faqs[idx] = updated;
          renderFaqs();
        }
        refreshAnalytics();
      } catch (err) {
        const idx = state.faqs.findIndex(f => f.id === realId || f.id === faqId);
        if (idx !== -1) {
          state.faqs[idx] = backupFaq;
          renderFaqs();
        }
        alert("Failed to update FAQ: " + err.message);
      }
    });
  } else {
    // Optimistic UI: create temporary FAQ
    const tempId = "temp_" + Date.now();
    const tempFaq = { ...payload, id: tempId, created_at: new Date().toISOString() };
    state.faqs.unshift(tempFaq);
    renderFaqs();
    
    faqQueue = faqQueue.then(async () => {
      try {
        const created = await api("/api/faqs", { method: "POST", body: JSON.stringify(payload) });
        faqIdMap[tempId] = created.id;
        const idx = state.faqs.findIndex(f => f.id === tempId);
        if (idx !== -1) {
          state.faqs[idx] = created;
          renderFaqs();
        }
        refreshAnalytics();
      } catch (err) {
        state.faqs = state.faqs.filter(f => f.id !== tempId && f.id !== faqIdMap[tempId]);
        renderFaqs();
        alert("Failed to create FAQ: " + err.message);
      }
    });
  }
});

$("importCsvBtn").addEventListener("click", () => $("faqCsvInput").click());
$("faqCsvInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();
  const rows = text.split("\n").map(r => r.trim()).filter(Boolean);
  if (!rows.length) return showToast("CSV is empty", "error");

  const headers = rows[0].toLowerCase().split(",");
  const hasQuestion = headers.includes("question") || headers.includes("q");
  const hasAnswer = headers.includes("answer") || headers.includes("a");
  
  const startIndex = (hasQuestion && hasAnswer) ? 1 : 0;
  let count = 0;
  
  const toast = showToast("Importing FAQs...", "loading", 0);
  
  const isSite = isSiteMode();
  const site_id = isSite ? state.currentSiteId : "";
  const group_id = !isSite ? state.currentGroupId : "";
  
  for (let i = startIndex; i < rows.length; i++) {
    // Simple CSV parser ignoring commas inside quotes
    const cols = rows[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    if (!cols || cols.length < 2) continue;
    
    const question = cols[0].replace(/^"|"$/g, "");
    const answer = cols[1].replace(/^"|"$/g, "");
    const aliasesStr = cols[2] ? cols[2].replace(/^"|"$/g, "") : "";
    const aliases = aliasesStr ? aliasesStr.split("|").map(s => s.trim()).filter(Boolean) : [];
    
    if (!question || !answer) continue;

    const payload = {
      question,
      answer,
      aliases,
      site_id,
      group_id,
      active: true
    };
    
    const tempId = "temp_" + Date.now() + "_" + i;
    const tempFaq = { ...payload, id: tempId, created_at: new Date().toISOString() };
    state.faqs.unshift(tempFaq);
    
    faqQueue = faqQueue.then(async () => {
      try {
        const created = await api("/api/faqs", { method: "POST", body: JSON.stringify(payload) });
        faqIdMap[tempId] = created.id;
        const idx = state.faqs.findIndex(f => f.id === tempId);
        if (idx !== -1) {
          state.faqs[idx] = created;
        }
      } catch (err) {
        state.faqs = state.faqs.filter(f => f.id !== tempId && f.id !== faqIdMap[tempId]);
        console.error("Failed to import row", i, err);
      }
    });
    count++;
  }
  
  renderFaqs();
  event.target.value = "";
  
  faqQueue.then(() => {
    finishToast(toast, `Imported ${count} FAQs`, "success");
    refreshAnalytics();
    renderFaqs();
  });
});

$("groupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const groupId = $("groupId").value.trim();
  const siteIds = selectedCheckboxValues("groupSite");
  if (siteIds.length < 2) {
    showToast("A group must contain at least 2 sites.", "error");
    return;
  }

  const payload = { 
    id: groupId || undefined, 
    name: $("groupName").value.trim(), 
    description: $("groupDescription").value.trim(), 
    site_ids: siteIds, 
    active: true 
  };

  // Optimistic UI: reset form and prepare state
  $("groupForm").reset();

  if (groupId && state.groups.some((group) => group.id === groupId)) {
    const idx = state.groups.findIndex(g => g.id === groupId);
    const backupGroup = state.groups[idx];
    
    // Update state optimistically
    state.groups[idx] = { ...backupGroup, ...payload, updated_at: new Date().toISOString() };
    renderReferenceControls();
    renderGroups();

    groupQueue = groupQueue.then(async () => {
      try {
        const { id, ...patch } = payload;
        const updated = await api(`/api/groups/${groupId}`, { method: "PATCH", body: JSON.stringify(patch) });
        const freshIdx = state.groups.findIndex(g => g.id === groupId);
        if (freshIdx !== -1) {
          state.groups[freshIdx] = updated;
          Cache.set("groups", state.groups);
          renderReferenceControls();
          renderGroups();
        }
      } catch (error) {
        const freshIdx = state.groups.findIndex(g => g.id === groupId);
        if (freshIdx !== -1) {
          state.groups[freshIdx] = backupGroup;
          renderReferenceControls();
          renderGroups();
        }
        alert("Failed to update group: " + error.message);
      }
    });
  } else {
    // Optimistic UI for creation
    const tempId = "temp_group_" + Date.now();
    const tempGroup = { 
      ...payload, 
      id: tempId, 
      created_at: new Date().toISOString(), 
      updated_at: new Date().toISOString() 
    };
    state.groups.unshift(tempGroup);
    renderReferenceControls();
    renderGroups();

    groupQueue = groupQueue.then(async () => {
      try {
        const created = await api("/api/groups", { method: "POST", body: JSON.stringify(payload) });
        const idx = state.groups.findIndex(g => g.id === tempId);
        if (idx !== -1) {
          state.groups[idx] = created;
          Cache.set("groups", state.groups);
          renderReferenceControls();
          renderGroups();
        }
      } catch (error) {
        state.groups = state.groups.filter(g => g.id !== tempId);
        renderReferenceControls();
        renderGroups();
        alert("Failed to create group: " + error.message);
      }
    });
  }
});

$("copySnippetBtn").addEventListener("click", () => navigator.clipboard.writeText($("snippetCode").textContent));


$("testForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = $("testQuestion").value.trim();
  if (!question) return;
  addMessage("user", question);
  $("testQuestion").value = "";
  const bot = addMessage("bot", "Thinking...", true); // skip save
  try {
    const response = await api("/api/chat/message", { method: "POST", body: JSON.stringify({ site_id: state.currentSiteId, session_id: state.sessionId, question }) });
    bot.querySelector(".bubble-text").textContent = response.answer;
    if (state.currentSiteId && state.testerSessions[state.currentSiteId]) {
      state.testerSessions[state.currentSiteId].messages.push({ type: "bot", text: response.answer });
      state.testerSessions[state.currentSiteId].updatedAt = Date.now();
      saveTesterSessions();
    }
    refreshLogs();
  } catch { 
    bot.querySelector(".bubble-text").textContent = "Sorry, something went wrong."; 
  }
});

function addMessage(type, text, skipSave = false) {
  const wrapper = document.createElement("div");
  wrapper.className = `message-wrapper ${type}`;
  wrapper.innerHTML = `
    <div class="message-bubble">
      <div class="bubble-text">${esc(text)}</div>
    </div>
  `;
  $("testMessages").appendChild(wrapper);
  $("testMessages").scrollTop = $("testMessages").scrollHeight;
  
  if (!skipSave && state.currentSiteId && state.testerSessions[state.currentSiteId]) {
    state.testerSessions[state.currentSiteId].messages.push({ type, text });
    state.testerSessions[state.currentSiteId].updatedAt = Date.now();
    saveTesterSessions();
  }
  
  return wrapper;
}
$("prevLogPage").addEventListener("click", () => {
  if (state.logPage > 0) {
    state.logPage--;
    refreshLogs();
  }
});

$("nextLogPage").addEventListener("click", () => {
  state.logPage++;
  refreshLogs();
});

window.showDistanceHelp = function(type) {
  const content = {
    accept: {
      title: "FAQ Accept Distance",
      body: `
        <p>This is the <strong>"Direct Match"</strong> threshold. If the user's question is closer than this value, the bot shows the FAQ answer immediately without using the AI.</p>
        <h4>Behavior:</h4>
        <ul>
          <li><strong>Lower values (e.g. 0.1):</strong> Very strict. Only matches if the user uses almost the exact same words.</li>
          <li><strong>Higher values (e.g. 0.3):</strong> More relaxed. Might show a FAQ even if the phrasing is slightly different.</li>
        </ul>
        <h4>Recommended: <code>0.10</code> to <code>0.20</code></h4>
      `
    },
    review: {
      title: "FAQ Review Distance",
      body: `
        <p>This is the <strong>"Safety Net"</strong> threshold. If no exact match exists, the bot checks whether the nearest FAQ is close enough to answer directly.</p>
        <h4>Behavior:</h4>
        <ul>
          <li>If a match is found within this distance, the bot shows that FAQ answer instead of falling back to the Helpline.</li>
        </ul>
        <h4>Recommended: <code>0.40</code> to <code>0.45</code></h4>
      `
    },
    candidate: {
      title: "Composite Candidate Distance",
      body: `
        <p>This threshold controls which nearby FAQs are eligible for composite answers when a user asks about multiple related things.</p>
        <h4>Behavior:</h4>
        <ul>
          <li>Nearby FAQ answers can be assembled together when more than one match passes review distance.</li>
          <li>If this value is too low, composite questions may fall back to one answer or the helpline.</li>
          <li>If it's too high, unrelated FAQs may be included.</li>
        </ul>
        <h4>Recommended: <code>0.55</code> to <code>0.65</code></h4>
      `
    }
  };

  const help = content[type];
  if (!help) return;

  $("helpTitle").textContent = help.title;
  $("helpBody").innerHTML = help.body;
  $("helpModal").showModal();
};
