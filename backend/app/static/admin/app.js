const state = {
  sites: [],
  groups: [],
  faqs: [],
  logs: [],
  currentSiteId: "",
  currentGroupId: "",
  sessionId: "",
  principal: null,
};

const $ = (id) => document.getElementById(id);

const Cache = {
  get: (key) => {
    try {
      const item = localStorage.getItem(`admin-cache:${key}`);
      if (!item) return null;
      const { data, expiry } = JSON.parse(item);
      if (Date.now() > expiry) {
        localStorage.removeItem(`admin-cache:${key}`);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  },
  set: (key, data, ttl = 600000) => {
    localStorage.setItem(`admin-cache:${key}`, JSON.stringify({ data, expiry: Date.now() + ttl }));
  },
  remove: (key) => localStorage.removeItem(`admin-cache:${key}`),
  clear: () => {
    Object.keys(localStorage).forEach((key) => key.startsWith("admin-cache:") && localStorage.removeItem(key));
  },
};

const SELECTION_KEY = "admin:selectedContext";

const firebaseConfig = {
  apiKey: "AIzaSyC1QxlKBkLpT2htParIuodhPNX6qtTGnlU",
  authDomain: "chatbot-faq-76909.firebaseapp.com",
  projectId: "chatbot-faq-76909",
};

let adminApp;
try {
  adminApp = firebase.initializeApp(firebaseConfig, "AdminApp");
} catch {
  adminApp = firebase.app("AdminApp");
}

const auth = firebase.auth(adminApp);
let adminVerifiedUser = null;
let authBootstrapped = false;
let authGeneration = 0;
let dashboardInitialized = false;

if (!localStorage.getItem("admin_session")) {
  showLogin();
}

function getSiteIdsFromClaims(claims = {}) {
  const raw = claims.site_ids || (claims.rbac && claims.rbac.site_ids) || [];
  if (typeof raw === "string") return raw.split(",").map((siteId) => siteId.trim()).filter(Boolean);
  if (Array.isArray(raw)) return raw.map((siteId) => String(siteId).trim()).filter(Boolean);
  return [];
}

async function createHandoffAndRedirect(idToken) {
  const response = await fetch("/api/handoff", {
    method: "GET",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) throw new Error(await response.text() || "Unable to create handoff token.");
  const data = await response.json();
  await auth.signOut();
  adminVerifiedUser = null;
  dashboardInitialized = false;
  localStorage.removeItem("admin_session");
  window.location.replace(`/portal/?handoff=${encodeURIComponent(data.firebase_token)}&from=admin`);
}

(async () => {
  await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
  auth.onAuthStateChanged(async (user) => {
    const generation = ++authGeneration;
    authBootstrapped = true;
    if (!user) {
      adminVerifiedUser = null;
      dashboardInitialized = false;
      localStorage.removeItem("admin_session");
      Cache.clear();
      $("userEmail").textContent = "";
      $("logoutBtn").style.display = "none";
      showLogin();
      return;
    }

    try {
      const idTokenResult = await user.getIdTokenResult(true);
      const siteIds = getSiteIdsFromClaims(idTokenResult.claims || {});
      if (generation !== authGeneration) return;
      if (!siteIds.includes("*")) {
        await createHandoffAndRedirect(idTokenResult.token);
        return;
      }

      adminVerifiedUser = user;
      localStorage.setItem("admin_session", idTokenResult.token);
      $("userEmail").textContent = user.email;
      $("logoutBtn").style.display = "inline-block";
      hideLogin();
      showToast("Access Verified", "success");
      initAdminDashboard();
    } catch (error) {
      console.error(error);
      await auth.signOut();
      adminVerifiedUser = null;
      dashboardInitialized = false;
      localStorage.removeItem("admin_session");
      Cache.clear();
      showLogin();
      $("loginError").textContent = error.message || "Authentication failed.";
    }
  });
})();

function initAdminDashboard() {
  if (!adminVerifiedUser || dashboardInitialized) return;
  dashboardInitialized = true;
  hydrateAdminFromCache();
  refreshAll();
}

async function adminHeaders(extra = {}) {
  const headers = { ...extra };
  if (!authBootstrapped) {
    await new Promise((resolve) => {
      const unsubscribe = auth.onAuthStateChanged(() => {
        unsubscribe();
        resolve();
      });
    });
  }
  if (adminVerifiedUser) {
    const token = await adminVerifiedUser.getIdToken();
    localStorage.setItem("admin_session", token);
    headers.Authorization = `Bearer ${token}`;
  }
  if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
  return headers;
}

async function api(path, options = {}) {
  const headers = await adminHeaders(options.headers || {});
  if (options.body instanceof FormData) delete headers["Content-Type"];
  setGlobalLoading(true);
  try {
    const response = await fetch(path.startsWith("/") ? path : `/${path}`, { ...options, headers });
    const bodyText = response.status === 204 ? "" : await response.text();
    if (response.status === 401) {
      localStorage.removeItem("admin_session");
      const detail = parseApiError(bodyText);
      throw new Error(detail ? `Session rejected: ${detail}` : "Session rejected. Sign out, sign in again, and check Firebase admin claims.");
    }
    if (!response.ok) throw new Error(parseApiError(bodyText) || `Request failed: ${response.status}`);
    if (response.status === 204) return null;
    return bodyText ? JSON.parse(bodyText) : null;
  } finally {
    setGlobalLoading(false);
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

function showLogin() {
  $("loginOverlay").classList.add("active");
  $("mainLayout").style.display = "none";
}

function hideLogin() {
  $("loginOverlay").classList.remove("active");
  $("mainLayout").style.display = "grid";
}

function setGlobalLoading(isLoading) {
  $("globalLoading").style.display = isLoading ? "inline-block" : "none";
}

function setStatus(text) {
  const el = $("statusText");
  if (el) el.textContent = text;
}

function showToast(message, type = "info", duration = 3000) {
  const container = $("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  let content = `<span>${message}</span>`;
  if (type === "loading") {
    content += `<div class="toast-spinner"></div>`;
  }
  
  toast.innerHTML = content;
  container.appendChild(toast);

  // Trigger animation
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

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function currentSite() {
  return state.sites.find((site) => site.id === state.currentSiteId);
}

function currentGroup() {
  return state.groups.find((group) => group.id === state.currentGroupId);
}

function isSiteMode() {
  return $("toggleSitesBtn")?.classList.contains("active") !== false;
}

function currentContextKey() {
  return isSiteMode() ? `site:${state.currentSiteId}` : `group:${state.currentGroupId}`;
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

function restoreSelectedContext() {
  try {
    const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) || "null");
    const savedSiteId = saved?.siteId || (saved?.mode === "site" ? saved.id : "");
    const savedGroupId = saved?.groupId || (saved?.mode === "group" ? saved.id : "");
    if (savedSiteId && state.sites.some((site) => site.id === savedSiteId && !site.deleted_at)) {
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
  if (!state.currentSiteId && !state.currentGroupId && state.sites.some((site) => !site.deleted_at)) {
    state.currentSiteId = state.sites.find((site) => !site.deleted_at).id;
    $("toggleSitesBtn")?.classList.add("active");
    $("toggleGroupsBtn")?.classList.remove("active");
  }
}

function clearCurrentContextCache() {
  const contextKey = currentContextKey();
  ["faqs", "logs", "analytics"].forEach((type) => Cache.remove(`${type}:${contextKey}`));
}

function renderFaqLoading() {
  if ($("faqsList")) $("faqsList").innerHTML = `<p class="meta">Retrieving knowledge base...</p>`;
}

function renderLogLoading() {
  if ($("logsList")) $("logsList").innerHTML = `<p class="meta">Retrieving conversation logs...</p>`;
}

function siteDisplay(site) {
  return site ? `${site.name} (${site.id})` : "";
}

function groupDisplay(group) {
  return group ? `${group.name} (${group.id})` : "";
}

function idFromChooser(value, items) {
  const trimmed = value.trim();
  const paren = trimmed.match(/\(([^()]+)\)$/);
  const candidate = paren ? paren[1] : trimmed;
  return items.find((item) => item.id === candidate || item.name === trimmed)?.id || candidate;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "n/a";
}

function recentStamp(record) {
  const created = record.created_at ? new Date(record.created_at).getTime() : 0;
  const updated = record.updated_at ? new Date(record.updated_at).getTime() : 0;
  if (updated && updated > created + 1000) return `Updated ${formatDate(record.updated_at)}`;
  return `Created ${formatDate(record.created_at)}`;
}

function deletionText(site) {
  if (!site.deleted_at) return "";
  const ms = new Date(site.purge_after).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(ms / 86400000));
  return `Deleted. Purges in ${days} day${days === 1 ? "" : "s"}.`;
}

async function refreshAll() {
  if (!adminVerifiedUser) return;
  try {
    const [me, sites, groups] = await Promise.all([
      api("/api/me"),
      api("/api/sites?include_deleted=true"),
      api("/api/groups"),
    ]);
    state.principal = me;
    state.sites = sites;
    state.groups = groups;
    Cache.set("me", me);
    Cache.set("sites", sites);
    Cache.set("groups", groups);
    restoreSelectedContext();
    renderReferenceControls();
    renderSites();
    renderGroups();
    renderUserSites();
    syncChoosers();
    refreshContextData();
  } catch (error) {
    setStatus(`Refresh failed: ${error.message}`);
  }
}

function hydrateAdminFromCache() {
  const me = Cache.get("me");
  const sites = Cache.get("sites");
  const groups = Cache.get("groups");
  if (!me || !sites || !groups) return;
  state.principal = me;
  state.sites = sites;
  state.groups = groups;
  restoreSelectedContext();
  renderReferenceControls();
  renderSites();
  renderGroups();
  renderUserSites();
  syncChoosers();
  const contextKey = currentContextKey();
  state.faqs = Cache.get(`faqs:${contextKey}`) || [];
  state.logs = Cache.get(`logs:${contextKey}`) || [];
  if (state.faqs.length) renderFaqs();
  if (state.logs.length) renderLogs();
  const cachedAnalytics = Cache.get(`analytics:${contextKey}`);
  if (cachedAnalytics) renderAnalytics(cachedAnalytics);
  setStatus("System Ready (Cached)");
}

function syncChoosers() {
  const isSite = $("toggleSitesBtn").classList.contains("active");
  const currentId = isSite ? state.currentSiteId : state.currentGroupId;
  
  if (!currentId) {
    $("noSelectionPrompt").classList.remove("hidden");
    $("selectionBar").classList.add("hidden");
    $("initialSelectBtn").textContent = isSite ? "Select Site" : "Select Group";
  } else {
    $("noSelectionPrompt").classList.add("hidden");
    $("selectionBar").classList.remove("hidden");
    
    if (isSite) {
      const site = currentSite();
      $("selectionLabel").textContent = "Selected Site";
      $("selectedName").textContent = site ? site.name : "Unknown Site";
    } else {
      const group = state.groups.find(g => g.id === state.currentGroupId);
      $("selectionLabel").textContent = "Selected Group";
      $("selectedName").textContent = group ? group.name : "Unknown Group";
    }
  }
  updateTesterSiteName();
  saveSelectedContext();
}

function renderReferenceControls() {
  $("siteOptions").innerHTML = state.sites
    .filter((site) => !site.deleted_at)
    .map((site) => `<option value="${esc(siteDisplay(site))}"></option>`)
    .join("");
  $("groupOptions").innerHTML = state.groups
    .map((group) => `<option value="${esc(groupDisplay(group))}"></option>`)
    .join("");
}

function filteredSites() {
  const query = $("siteSearch")?.value?.trim().toLowerCase() || "";
  const filter = $("siteFilter")?.value || "active";
  return state.sites
    .filter((site) => {
      if (filter === "active" && site.deleted_at) return false;
      if (filter === "deleted" && !site.deleted_at) return false;
      if (!query) return true;
      return [site.name, site.id, site.domain, site.helpline_number]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    })
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
}

function renderSites() {
  const sites = filteredSites();
  $("sitesList").innerHTML = sites.length
    ? sites.map((site) => {
        const isSaving = String(site.id).startsWith("saving-");
        return `
        <div class="row ${isSaving ? "is-saving" : ""}" style="position:relative; overflow:hidden;">
          <div class="row-info">
            <p class="row-title">${esc(site.name)}</p>
            <p class="meta">${esc(site.id)} | ${esc(site.domain || "no domain")}</p>
            <p class="meta">${recentStamp(site)} ${site.deleted_at ? "| " + deletionText(site) : ""}</p>
          </div>
          <div class="row-actions">
            <button class="ghost" onclick="editSite('${esc(site.id)}')" ${isSaving ? "disabled" : ""}>Select</button>
            <button class="secondary" onclick="openSitePortal('${esc(site.id)}')" ${site.deleted_at || isSaving ? "disabled" : ""}>Open Portal</button>
          </div>
          ${isSaving ? '<div class="item-progress"></div>' : ""}
        </div>`;
      }).join("")
    : `<p class="meta">No sites found.</p>`;
}

function groupMatches(group) {
  const query = $("groupSearch")?.value?.trim().toLowerCase() || "";
  if (!query) return true;
  const siteNames = group.site_ids.map((id) => state.sites.find((site) => site.id === id)?.name || id).join(" ");
  return [group.name, group.id, group.description, siteNames].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
}

function renderGroups() {
  $("groupSiteChecks").innerHTML = siteCheckboxes("groupSite", selectedCheckboxValues("groupSite"), $("groupSiteSearch")?.value || "");
  const filter = $("groupFilter")?.value || "latest";
  const groups = state.groups.filter(groupMatches).sort((a, b) => {
    const timeA = new Date(a.updated_at || a.created_at).getTime();
    const timeB = new Date(b.updated_at || b.created_at).getTime();
    return filter === "oldest" ? timeA - timeB : timeB - timeA;
  });
  $("groupsList").innerHTML = groups.length
    ? groups.map((group) => {
        const isSaving = String(group.id).startsWith("saving-");
        return `
        <div class="row ${isSaving ? "is-saving" : ""}" style="position:relative; overflow:hidden;">
          <div>
            <p class="row-title">${esc(group.name)}</p>
            <p class="meta">${esc(group.id)} | ${recentStamp(group)}</p>
          </div>
          <div class="actions">
            <button class="secondary" onclick="editGroup('${esc(group.id)}')" ${isSaving ? "disabled" : ""}>Edit</button>
            <button class="danger" onclick="deleteGroup('${esc(group.id)}')" ${isSaving ? "disabled" : ""}>Delete</button>
          </div>
          ${isSaving ? '<div class="item-progress"></div>' : ""}
        </div>`;
      }).join("")
    : `<p class="meta">No groups found.</p>`;
}

function siteCheckboxes(name, selected = [], query = "") {
  const needle = query.trim().toLowerCase();
  return state.sites
    .filter((site) => !site.deleted_at)
    .filter((site) => !needle || [site.name, site.id, site.domain].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)))
    .map((site) => `
      <label>
        <input name="${name}" type="checkbox" value="${esc(site.id)}" ${selected.includes(site.id) ? "checked" : ""} />
        ${esc(site.name)} <span class="meta">${esc(site.id)}</span>
      </label>`)
    .join("");
}

function selectedCheckboxValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function renderUserSites() {
  $("userSiteChecks").innerHTML = siteCheckboxes("userSite", selectedCheckboxValues("userSite"), $("userSiteSearch")?.value || "");
}

async function refreshFaqs({ force = false } = {}) {
  const isSite = $("toggleSitesBtn").classList.contains("active");
  const currentId = isSite ? state.currentSiteId : state.currentGroupId;

  if (!currentId) {
    state.faqs = [];
    renderFaqs();
    return;
  }

  const params = new URLSearchParams();
  if (isSite) params.set("site_id", currentId);
  else params.set("group_id", currentId);

  const contextKey = currentContextKey();
  const cached = force ? null : Cache.get(`faqs:${contextKey}`);
  if (cached) {
    state.faqs = cached;
    renderFaqs();
  } else {
    state.faqs = [];
    renderFaqLoading();
    setStatus(`Retrieving FAQs for ${contextDisplayName()}...`);
  }

  try {
    const faqs = await api(`/api/faqs?${params.toString()}`);
    state.faqs = faqs;
    Cache.set(`faqs:${contextKey}`, faqs);
    renderFaqs();
  } catch (err) {
    state.faqs = [];
    renderFaqs();
  }
}

function renderFaqs() {
  const query = $("faqSearch")?.value?.trim()?.toLowerCase() || "";
  const faqs = state.faqs.filter((faq) => {
    if (!query) return true;
    return [faq.question, faq.answer, faq.id, ...(faq.aliases || [])].some((value) => String(value || "").toLowerCase().includes(query));
  });
  $("faqsList").innerHTML = faqs.length
    ? faqs.map((faq) => {
        const isSaving = String(faq.id).startsWith("saving-");
        const target = faq.site_id
          ? `Site: ${state.sites.find((site) => site.id === faq.site_id)?.name || faq.site_id}`
          : `Group: ${state.groups.find((group) => group.id === faq.group_id)?.name || faq.group_id}`;
        return `
          <article class="faq-item ${isSaving ? "is-saving" : ""}">
            <div>
              <h3>${esc(faq.question)}</h3>
              <p class="meta">${esc(target)} | ${recentStamp(faq)}</p>
            </div>
            <div class="faq-answer">${esc(faq.answer)}</div>
            <p class="meta">Aliases: ${esc((faq.aliases || []).join(", ") || "none")}</p>
            <div class="actions">
              <button class="secondary" onclick="editFaq('${esc(faq.id)}')" ${isSaving ? "disabled" : ""}>Edit</button>
              <button class="danger" onclick="deleteFaq('${esc(faq.id)}')" ${isSaving ? "disabled" : ""}>Delete</button>
            </div>
            ${isSaving ? '<div class="item-progress"></div>' : ""}
          </article>`;
      }).join("")
    : `<p class="meta">No FAQs found.</p>`;
}

async function refreshLogs({ force = false } = {}) {
  const isSite = $("toggleSitesBtn").classList.contains("active");
  const currentId = isSite ? state.currentSiteId : state.currentGroupId;

  if (!currentId) {
    state.logs = [];
    renderLogs();
    return;
  }

  const params = new URLSearchParams();
  if (isSite) params.set("site_id", currentId);
  else params.set("group_id", currentId);

  const type = $("logTypeFilter")?.value;
  const dateRange = $("logDateFilter")?.value;
  if (type) params.set("type", type);
  if (dateRange) params.set("date_range", dateRange);

  const contextKey = currentContextKey();
  const cached = force ? null : Cache.get(`logs:${contextKey}`);
  if (cached) {
    state.logs = cached;
    renderLogs();
  } else {
    state.logs = [];
    renderLogLoading();
    setStatus(`Retrieving logs for ${contextDisplayName()}...`);
  }

  try {
    const response = await api(`/api/logs?${params.toString()}`);
    state.logs = Array.isArray(response) ? response : (response?.logs || []);
    Cache.set(`logs:${contextKey}`, state.logs);
    renderLogs();
  } catch (err) {
    state.logs = [];
    renderLogs();
  }
}

function renderLogs() {
  const query = $("logSearch")?.value?.trim()?.toLowerCase() || "";
  const logs = state.logs.filter((log) => !query || [log.question, log.answer, log.email, log.phone, log.user_name].some((value) => String(value || "").toLowerCase().includes(query)));
  $("logsList").innerHTML = logs.length
    ? logs.map((log) => `
        <article class="log-item log-${esc(log.response_type)}">
          <div>
            <h3>${esc(log.question)}</h3>
            <p class="meta"><span class="badge">${esc(log.response_type.replaceAll("_", " "))}</span> ${formatDate(log.timestamp)} | ${esc(log.user_name || "anonymous")}</p>
          </div>
          <div class="log-answer">${esc(log.answer)}</div>
          <p class="meta">${esc(log.email || "no email")} | ${esc(log.phone || "no phone")} | distance ${log.vector_distance ?? "n/a"}</p>
          <div class="actions"><button class="secondary" onclick="convertLog('${esc(log.id)}')">Add as FAQ</button></div>
        </article>`).join("")
    : `<p class="meta">No logs found.</p>`;
}

async function refreshAnalytics({ force = false } = {}) {
  const isSite = $("toggleSitesBtn").classList.contains("active");
  const currentId = isSite ? state.currentSiteId : state.currentGroupId;
  if (!currentId) {
    resetStats();
    return;
  }

  const contextKey = currentContextKey();
  const cached = force ? null : Cache.get(`analytics:${contextKey}`);
  if (cached) renderAnalytics(cached);
  else {
    resetStats();
    setStatus(`Retrieving analytics for ${contextDisplayName()}...`);
  }

  const url = isSite ? `/api/sites/${currentId}/analytics` : `/api/groups/${currentId}/analytics`;

  try {
    const data = await api(url);
    Cache.set(`analytics:${contextKey}`, data);
    renderAnalytics(data);
  } catch (err) {
    console.error(err);
    resetStats();
  }
}

function resetStats() {
  renderAnalytics({ total_queries: 0, hit_rate: 0, faq_hits: 0, llm_rate: 0, llm_fallbacks: 0, helpline_rate: 0, top_faqs: [] });
}

function renderAnalytics(data) {
  if ($("statTotal")) $("statTotal").textContent = data.total_queries || 0;
  if ($("statHitRate")) $("statHitRate").textContent = `${data.hit_rate || 0}%`;
  if ($("statFaqHits")) $("statFaqHits").textContent = `${data.faq_hits || 0} hits`;
  if ($("statLlmRate")) $("statLlmRate").textContent = `${data.llm_rate || 0}%`;
  if ($("statLlmHits")) $("statLlmHits").textContent = `${data.llm_fallbacks || 0} fallbacks`;
  if ($("statHelplineRate")) $("statHelplineRate").textContent = `${data.helpline_rate || 0}%`;

  if ($("topFaqsList")) {
    $("topFaqsList").innerHTML = data.top_faqs?.length
      ? data.top_faqs.map((faq) => `<div class="row"><p class="row-title">${esc(faq.question)}</p><div class="meta">${faq.count} uses</div><div></div></div>`).join("")
      : `<p class="meta">No FAQs used yet.</p>`;
  }
}

async function refreshContextData({ force = false } = {}) {
  if (force) clearCurrentContextCache();
  setStatus(`${force ? "Refreshing" : "Loading"} ${contextDisplayName()}...`);
  await refreshAnalytics({ force });
  await Promise.all([refreshFaqs({ force }), refreshLogs({ force })]);
  setStatus("System Ready");
}

function selectSite(siteId) {
  state.currentSiteId = siteId;
  state.sessionId = "";
  syncChoosers();
  $("testMessages").innerHTML = "";
  $("leadForm").classList.remove("hidden");
  $("testForm").classList.add("hidden");
  refreshContextData();
}

function selectGroup(groupId) {
  state.currentGroupId = groupId;
  syncChoosers();
  refreshContextData();
}

window.editSite = function editSite(siteId) {
  const site = state.sites.find((item) => item.id === siteId);
  if (!site) return;
  $("siteModalTitle").textContent = "Edit Site";
  $("siteId").value = site.id;
  $("siteName").value = site.name;
  $("siteDomain").value = site.domain || "";
  $("siteHelpline").value = site.helpline_number || "";
  $("siteWelcome").value = site.welcome_message || "";
  $("siteFallback").value = site.fallback_message || "";
  $("siteAcceptDistance").value = site.faq_accept_distance ?? "";
  $("siteCandidateDistance").value = site.llm_candidate_distance ?? "";
  $("siteAllowedOrigins").value = (site.allowed_origins || []).join(", ");
  $("sitePrimaryColor").value = site.primary_color || "#22c55e";
  $("siteBotName").value = site.bot_name || "";
  $("siteBotAvatar").value = site.bot_avatar_url || "";
  $("siteLauncherIcon").value = site.launcher_icon || "?";
  $("siteActive").checked = site.active !== false;
  $("repairSiteBtn").style.display = "inline-block";
  $("deleteSiteBtn").style.display = "inline-block";
  $("siteModal").showModal();
};

function openCreateSiteModal() {
  $("siteModalTitle").textContent = "Create Site";
  $("siteForm").reset();
  $("siteId").value = "";
  $("sitePrimaryColor").value = "#22c55e";
  $("siteActive").checked = true;
  $("repairSiteBtn").style.display = "none";
  $("deleteSiteBtn").style.display = "none";
  $("siteModal").showModal();
}

function sitePayload() {
  const payload = {
    name: $("siteName").value.trim(),
    domain: $("siteDomain").value.trim(),
    helpline_number: $("siteHelpline").value.trim(),
    welcome_message: $("siteWelcome").value.trim() || "Hi, how can I help?",
    fallback_message: $("siteFallback").value.trim() || "I could not find the exact answer. Please contact our helpline.",
    active: $("siteActive").checked,
    allowed_origins: $("siteAllowedOrigins").value.split(",").map((s) => s.trim()).filter(Boolean),
    primary_color: $("sitePrimaryColor").value,
    bot_name: $("siteBotName").value.trim() || "Support Bot",
    bot_avatar_url: $("siteBotAvatar").value.trim(),
    launcher_icon: $("siteLauncherIcon").value.trim() || "?",
  };
  if ($("siteAcceptDistance").value !== "") payload.faq_accept_distance = Number($("siteAcceptDistance").value);
  if ($("siteCandidateDistance").value !== "") payload.llm_candidate_distance = Number($("siteCandidateDistance").value);
  return payload;
}

window.openSitePortal = async function openSitePortal(siteId) {
  try {
    const res = await api("/api/handoff");
    window.open(`/portal/?handoff=${encodeURIComponent(res.firebase_token)}&site_id=${encodeURIComponent(siteId)}`, "_blank");
  } catch (error) {
    alert(`Handoff failed: ${error.message}`);
  }
};

window.editGroup = function editGroup(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  $("groupModalTitle").textContent = "Edit Group";
  $("groupId").value = group.id;
  $("groupName").value = group.name;
  $("groupDescription").value = group.description || "";
  $("groupSiteChecks").innerHTML = siteCheckboxes("groupSite", group.site_ids || [], $("groupSiteSearch").value);
  $("groupModal").showModal();
};

window.deleteGroup = async function deleteGroup(groupId) {
  if (!confirm("Delete this group?")) return;
  const previous = [...state.groups];
  const toast = showToast("Deleting group...", "loading", 0);
  state.groups = state.groups.filter((group) => group.id !== groupId);
  renderGroups();
  try {
    await api(`/api/groups/${groupId}`, { method: "DELETE" });
    finishToast(toast, "Group deleted", "success");
  } catch (error) {
    state.groups = previous;
    renderGroups();
    finishToast(toast, `Delete failed: ${error.message}`, "error", 3500);
  }
};

function openCreateFaqModal() {
  const isSite = $("toggleSitesBtn").classList.contains("active");
  const currentId = isSite ? state.currentSiteId : state.currentGroupId;

  if (!currentId) {
    showToast(`Please select a ${isSite ? "site" : "group"} first.`, "error");
    return;
  }

  $("faqModalTitle").textContent = "Add FAQ";
  setFaqFieldsDisabled(false);
  $("faqDeleteConfirmText").classList.add("hidden");
  $("faqSaveBtn").classList.remove("hidden");
  $("faqDeleteBtn").classList.add("hidden");
  clearFaqForm();
  $("faqModal").showModal();
}

function setFaqFieldsDisabled(disabled) {
  $("faqQuestion").disabled = disabled;
  $("faqAliases").disabled = disabled;
  $("faqAnswer").disabled = disabled;
}

window.editFaq = function editFaq(faqId) {
  const faq = state.faqs.find((item) => item.id === faqId);
  if (!faq) return;
  $("faqModalTitle").textContent = "Edit FAQ";
  $("faqId").value = faq.id;
  $("faqQuestion").value = faq.question;
  $("faqAliases").value = (faq.aliases || []).join("\n");
  $("faqAnswer").value = faq.answer;

  setFaqFieldsDisabled(false);
  $("faqDeleteConfirmText").classList.add("hidden");
  $("faqSaveBtn").classList.remove("hidden");
  $("faqDeleteBtn").classList.add("hidden");

  $("faqModal").showModal();
};

window.deleteFaq = function deleteFaq(faqId) {
  const faq = state.faqs.find((item) => item.id === faqId);
  if (!faq) return;
  $("faqModalTitle").textContent = "Delete FAQ?";
  $("faqId").value = faq.id;
  $("faqQuestion").value = faq.question;
  $("faqAliases").value = (faq.aliases || []).join("\n");
  $("faqAnswer").value = faq.answer;

  setFaqFieldsDisabled(true);
  $("faqDeleteConfirmText").classList.remove("hidden");
  $("faqSaveBtn").classList.add("hidden");
  $("faqDeleteBtn").classList.remove("hidden");
  
  $("faqModal").showModal();
};

$("faqDeleteBtn").addEventListener("click", async () => {
  const faqId = $("faqId").value;
  if (!faqId) return;
  
  const previous = [...state.faqs];
  const toast = showToast("Deleting FAQ...", "loading", 0);
  state.faqs = state.faqs.filter((f) => f.id !== faqId);
  renderFaqs();
  $("faqModal").close();

  try {
    await api(`/api/faqs/${faqId}`, { method: "DELETE" });
    finishToast(toast, "FAQ deleted", "success");
    refreshAnalytics();
  } catch (error) {
    state.faqs = previous;
    renderFaqs();
    finishToast(toast, error.message, "error", 3500);
  }
});



window.convertLog = async function convertLog(logId) {
  const log = state.logs.find((item) => item.id === logId);
  if (!log) return;
  const answer = prompt("Answer to save for this FAQ:", log.answer);
  if (!answer) return;
  const created = await api(`/api/logs/${logId}/convert-to-faq`, {
    method: "POST",
    body: JSON.stringify({ question: log.question, answer, aliases: [], site_id: log.site_id, group_id: "" }),
  });
  state.faqs.unshift(created);
  renderFaqs();
  refreshLogs();
};

function clearFaqForm() {
  $("faqId").value = "";
  $("faqQuestion").value = "";
  $("faqAliases").value = "";
  $("faqAnswer").value = "";
}

$("faqForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const faqId = $("faqId").value.trim();
  const isSite = $("toggleSitesBtn").classList.contains("active");
  const currentId = isSite ? state.currentSiteId : state.currentGroupId;

  if (!currentId) {
    showToast("Please select a site or group first.", "error");
    return;
  }

  const payload = {
    question: $("faqQuestion").value.trim(),
    answer: $("faqAnswer").value.trim(),
    aliases: $("faqAliases").value.split("\n").map((s) => s.trim()).filter(Boolean),
    site_id: isSite ? currentId : "",
    group_id: !isSite ? currentId : "",
  };

  const previous = [...state.faqs];
  $("faqModal").close();
  $("faqForm").reset();
  const toast = showToast(faqId ? "Saving FAQ..." : "Creating FAQ...", "loading", 0);

  try {
    if (faqId) {
      const index = state.faqs.findIndex((f) => f.id === faqId);
      if (index !== -1) state.faqs[index] = { ...state.faqs[index], ...payload, updated_at: new Date().toISOString() };
      renderFaqs();
      const updated = await api(`/api/faqs/${faqId}`, { method: "PATCH", body: JSON.stringify(payload) });
      state.faqs[index] = updated;
    } else {
      const temp = { ...payload, id: `saving-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.faqs.unshift(temp);
      renderFaqs();
      const created = await api("/api/faqs", { method: "POST", body: JSON.stringify(payload) });
      state.faqs = state.faqs.map((f) => (f.id === temp.id ? created : f));
    }
    renderFaqs();
    finishToast(toast, "FAQ saved", "success");
  } catch (error) {
    state.faqs = previous;
    renderFaqs();
    finishToast(toast, error.message, "error", 3500);
  }
});

function updateTesterSiteName() {
  $("testerSiteName").textContent = currentSite()?.name || "No site selected";
}

function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabId));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active-panel", panel.id === tabId));
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const toast = showToast("Signing in...", "loading", 0);
  $("loginError").textContent = "";
  try {
    await auth.signOut();
    localStorage.removeItem("admin_session");
    await auth.signInWithEmailAndPassword($("loginEmail").value, $("loginPassword").value);
    toast.update("Authenticated!", "success");
    setTimeout(() => toast.close(), 2000);
  } catch (error) {
    toast.update("Login Failed", "error");
    setTimeout(() => toast.close(), 3000);
    $("loginError").textContent = error.message;
    auth.signOut();
  }
});

$("logoutBtn").addEventListener("click", () => {
  adminVerifiedUser = null;
  dashboardInitialized = false;
  auth.signOut();
  localStorage.removeItem("admin_session");
  Cache.clear();
  showLogin();
});

$("refreshBtn") && $("refreshBtn").addEventListener("click", refreshAll);
$("addSiteBtn") && $("addSiteBtn").addEventListener("click", openCreateSiteModal);
$("closeSiteModalBtn") && $("closeSiteModalBtn").addEventListener("click", () => $("siteModal").close());
$("createFaqBtn") && $("createFaqBtn").addEventListener("click", openCreateFaqModal);
$("closeFaqModalBtn") && $("closeFaqModalBtn").addEventListener("click", () => $("faqModal").close());
$("clearFaqBtn") && $("clearFaqBtn").addEventListener("click", clearFaqForm);

["siteFilter"].forEach((id) => $(id) && $(id).addEventListener("input", renderSites));
["groupFilter"].forEach((id) => $(id) && $(id).addEventListener("input", renderGroups));
$("groupSiteSearch") && $("groupSiteSearch").addEventListener("input", renderGroups);
$("userSiteSearch") && $("userSiteSearch").addEventListener("input", renderUserSites);
$("logSearch") && $("logSearch").addEventListener("input", renderLogs);
["fallbackOnly", "logTypeFilter", "logDateFilter"].forEach((id) => $(id) && $(id).addEventListener("change", refreshLogs));

$("toggleSitesBtn").addEventListener("click", () => {
  $("toggleSitesBtn").classList.add("active");
  $("toggleGroupsBtn").classList.remove("active");
  if (!state.currentSiteId && state.sites.some((site) => !site.deleted_at)) state.currentSiteId = state.sites.find((site) => !site.deleted_at).id;
  syncChoosers();
  refreshContextData();
});

$("toggleGroupsBtn").addEventListener("click", () => {
  $("toggleGroupsBtn").classList.add("active");
  $("toggleSitesBtn").classList.remove("active");
  if (!state.currentGroupId && state.groups.length) state.currentGroupId = state.groups[0].id;
  syncChoosers();
  refreshContextData();
});
$("refreshContextBtn")?.addEventListener("click", () => refreshContextData({ force: true }));

$("openSwitchBtn").addEventListener("click", openSelectionModal);
$("initialSelectBtn").addEventListener("click", openSelectionModal);
$("closeSelectionModalBtn").addEventListener("click", () => $("selectionModal").close());
$("selectionSearch").addEventListener("input", renderSelectionList);

function openSelectionModal() {
  const isSite = $("toggleSitesBtn").classList.contains("active");
  $("selectionModalTitle").textContent = isSite ? "Select Site" : "Select Group";
  $("selectionSearch").value = "";
  renderSelectionList();
  $("selectionModal").showModal();
}

function renderSelectionList() {
  const isSite = $("toggleSitesBtn").classList.contains("active");
  const query = $("selectionSearch").value.trim().toLowerCase();
  const list = $("selectionList");
  
  let items = isSite ? state.sites.filter(s => !s.deleted_at) : state.groups;
  if (query) {
    items = items.filter(item => 
      [item.name, item.id].some(v => String(v).toLowerCase().includes(query))
    );
  }

  list.innerHTML = items.map(item => `
    <div class="selection-item ${((isSite ? state.currentSiteId : state.currentGroupId) === item.id) ? "active" : ""}" 
         onclick="handleSelectionClick('${esc(item.id)}')">
      <div class="selection-info">
        <p class="row-title">${esc(item.name)}</p>
        <p class="meta">${esc(item.id)}</p>
      </div>
    </div>
  `).join("") || `<p class="meta">No items found.</p>`;
}

window.handleSelectionClick = function(id) {
  const isSite = $("toggleSitesBtn").classList.contains("active");
  if (isSite) {
    selectSite(id);
  } else {
    selectGroup(id);
  }
  $("selectionModal").close();
};

function selectSite(id) {
  state.currentSiteId = id;
  syncChoosers();
  refreshContextData();
}

function selectGroup(id) {
  state.currentGroupId = id;
  syncChoosers();
  refreshContextData();
}

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));

$("createGroupBtn").addEventListener("click", () => {
  $("groupModalTitle").textContent = "Create Group";
  $("groupForm").reset();
  $("groupId").value = "";
  $("groupSiteChecks").innerHTML = siteCheckboxes("groupSite", [], $("groupSiteSearch").value);
  $("groupModal").showModal();
});
$("closeGroupModalBtn").addEventListener("click", () => $("groupModal").close());

$("siteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("siteModal").close();
  const siteId = $("siteId").value.trim();
  const payload = sitePayload();
  const previous = [...state.sites];
  $("siteForm").reset();
  const toast = showToast(siteId ? "Saving site..." : "Creating site...", "loading", 0);

  try {
    if (siteId) {
      const index = state.sites.findIndex((site) => site.id === siteId);
      if (index !== -1) {
        state.sites[index] = { ...state.sites[index], ...payload, updated_at: new Date().toISOString() };
        renderSites();
      }
      const updated = await api(`/api/sites/${siteId}`, { method: "PATCH", body: JSON.stringify(payload) });
      state.sites[index] = updated;
      if (state.currentSiteId === siteId) syncChoosers();
    } else {
      const temp = { ...payload, id: `saving-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.sites.unshift(temp);
      renderSites();
      const created = await api("/api/sites", { method: "POST", body: JSON.stringify(payload) });
      state.sites = state.sites.map((site) => (site.id === temp.id ? created : site));
      state.currentSiteId = created.id;
    }
    renderReferenceControls();
    renderSites();
    renderUserSites();
    syncChoosers();
    finishToast(toast, siteId ? "Site saved" : "Site created", "success");
  } catch (error) {
    state.sites = previous;
    renderSites();
    finishToast(toast, `Save failed: ${error.message}`, "error", 3500);
  }
});

$("repairSiteBtn").addEventListener("click", async () => {
  const siteId = $("siteId").value;
  if (!siteId) return;
  $("siteModal").close();
  const toast = showToast("Repairing vectors...", "loading", 0);
  try {
    const result = await api(`/api/sites/${siteId}/reindex`, { method: "POST" });
    finishToast(toast, `Repair started: ${result.total_items ?? 0} FAQs will be reindexed in the background`, "success", 5000);
  } catch (error) {
    finishToast(toast, `Repair failed: ${error.message}`, "error", 5000);
  }
});

$("deleteSiteBtn").addEventListener("click", async () => {
  const siteId = $("siteId").value;
  if (!siteId) return;
  $("siteModal").close();
  const previous = [...state.sites];
  const toast = showToast("Deleting site...", "loading", 0);
  state.sites = state.sites.map((s) => (s.id === siteId ? { ...s, deleted_at: new Date().toISOString() } : s));
  renderSites();
  try {
    await api(`/api/sites/${siteId}`, { method: "DELETE" });
    finishToast(toast, "Site deleted", "success");
  } catch (error) {
    state.sites = previous;
    renderSites();
    finishToast(toast, error.message, "error", 3500);
  }
});

window.deleteSite = async function deleteSite(siteId) {
  if (!confirm("Delete this site? It will be moved to Recently Deleted.")) return;
  const previous = [...state.sites];
  const toast = showToast("Deleting site...", "loading", 0);
  state.sites = state.sites.map((s) => (s.id === siteId ? { ...s, deleted_at: new Date().toISOString() } : s));
  renderSites();
  try {
    await api(`/api/sites/${siteId}`, { method: "DELETE" });
    finishToast(toast, "Site deleted", "success");
  } catch (error) {
    state.sites = previous;
    renderSites();
    finishToast(toast, error.message, "error", 3500);
  }
};

window.deleteGroup = async function deleteGroup(groupId) {
  if (!confirm("Delete this group?")) return;
  const previous = [...state.groups];
  const toast = showToast("Deleting group...", "loading", 0);
  state.groups = state.groups.filter((g) => g.id !== groupId);
  renderGroups();
  try {
    await api(`/api/groups/${groupId}`, { method: "DELETE" });
    finishToast(toast, "Group deleted", "success");
  } catch (error) {
    state.groups = previous;
    renderGroups();
    finishToast(toast, error.message, "error", 3500);
  }
};

$("groupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("groupModal").close();
  const groupId = $("groupId").value.trim();
  const payload = {
    id: groupId || undefined,
    name: $("groupName").value.trim(),
    description: $("groupDescription").value.trim(),
    site_ids: selectedCheckboxValues("groupSite"),
  };
  const previous = [...state.groups];
  $("groupForm").reset();
  const toast = showToast(groupId ? "Saving group..." : "Creating group...", "loading", 0);

  try {
    if (groupId && state.groups.some((group) => group.id === groupId)) {
      const index = state.groups.findIndex((group) => group.id === groupId);
      state.groups[index] = { ...state.groups[index], ...payload, updated_at: new Date().toISOString() };
      renderGroups();
      const { id, ...patch } = payload;
      state.groups[index] = await api(`/api/groups/${groupId}`, { method: "PATCH", body: JSON.stringify(patch) });
    } else {
      const temp = { ...payload, id: groupId || `saving-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.groups.unshift(temp);
      renderGroups();
      const created = await api("/api/groups", { method: "POST", body: JSON.stringify(payload) });
      state.groups = state.groups.map((group) => (group.id === temp.id ? created : group));
    }
    renderReferenceControls();
    renderGroups();
    finishToast(toast, groupId ? "Group saved" : "Group created", "success");
  } catch (error) {
    state.groups = previous;
    renderGroups();
    finishToast(toast, `Save failed: ${error.message}`, "error", 3500);
  }
});



$("userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const site_ids = selectedCheckboxValues("userSite");
  if (!site_ids.length) {
    showToast("Select at least one site.", "error");
    return;
  }
  const toast = showToast("Creating user...", "loading", 0);
  try {
    const result = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        email: $("userEmailInput").value.trim(),
        password: $("userPasswordInput").value.trim(),
        site_ids,
      }),
    });
    finishToast(toast, result.message || "User created", "success");
    event.target.reset();
    renderUserSites();
  } catch (error) {
    finishToast(toast, `Failed to create user: ${error.message}`, "error", 3500);
  }
});

$("leadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.currentSiteId) return alert("Choose a site first.");
  const btn = $("startSessionBtn");
  btn.disabled = true;
  try {
    const session = await fetch("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: state.currentSiteId,
        name: $("testName").value,
        email: $("testEmail").value,
        phone: $("testPhone").value,
      }),
    }).then((response) => response.json());
    state.sessionId = session.id;
    addMessage("bot", `Session started for ${currentSite()?.name || state.currentSiteId}.`);
    $("leadForm").classList.add("hidden");
    $("testForm").classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
});

$("testForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = $("testQuestion").value.trim();
  if (!question || !state.currentSiteId) return;
  addMessage("user", question);
  $("testQuestion").value = "";
  const thinkingNode = addMessage("bot", "Thinking...");
  try {
    const response = await fetch("/api/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site_id: state.currentSiteId, session_id: state.sessionId, question }),
    }).then((item) => item.json());
    thinkingNode.querySelector(".msg-text").textContent = response.answer;
    refreshLogs();
  } catch {
    thinkingNode.querySelector(".msg-text").textContent = "Sorry, something went wrong.";
  }
});

function addMessage(type, text) {
  const node = document.createElement("div");
  node.className = `message ${type}`;
  const span = document.createElement("span");
  span.className = "msg-text";
  span.textContent = text;
  node.appendChild(span);
  $("testMessages").appendChild(node);
  $("testMessages").scrollTop = $("testMessages").scrollHeight;
  return node;
}
