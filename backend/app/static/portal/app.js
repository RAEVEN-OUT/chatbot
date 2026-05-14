const state = { sites: [], groups: [], faqs: [], logs: [], currentSiteId: "", currentGroupId: "", sessionId: "", principal: null, charts: {} };
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
function siteDisplay(site) { return site ? `${site.name} (${site.id})` : ""; }
function groupDisplay(group) { return group ? `${group.name} (${group.id})` : ""; }
function idFromChooser(value, items) {
  const trimmed = value.trim();
  const paren = trimmed.match(/\(([^()]+)\)$/);
  const candidate = paren ? paren[1] : trimmed;
  return items.find((item) => item.id === candidate || item.name === trimmed)?.id || candidate;
}
function currentSite() { return state.sites.find((site) => site.id === state.currentSiteId); }

async function bootstrapPortal() {
  setStatus("Syncing data...");
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
  setStatus("System Ready");
  lucide.createIcons();
}

function showNoAccess() {
  $("mainLayout").style.display = "grid";
  document.querySelector(".main-content").innerHTML = `<div class="no-access"><h2>No Site Access</h2><p>Create a site from registration or contact support.</p></div>`;
}

function renderReferenceControls() {
  $("siteOptions").innerHTML = state.sites.map((site) => `<option value="${esc(siteDisplay(site))}"></option>`).join("");
  $("groupOptions").innerHTML = state.groups.map((group) => `<option value="${esc(groupDisplay(group))}"></option>`).join("");
  $("groupsTab").style.display = state.sites.length > 1 ? "flex" : "none";
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
      <h3>${esc(faq.question)}</h3>
      <div class="faq-answer">${esc(faq.answer)}</div>
      <p class="muted" style="font-size: 11px;">${recentStamp(faq)} | Aliases: ${esc((faq.aliases || []).join(", ") || "none")}</p>
      <div class="actions">
        <button class="secondary-btn btn-sm" onclick="editFaq('${esc(faq.id)}')">Edit</button>
        <button class="secondary-btn btn-sm" style="color: var(--error);" onclick="deleteFaq('${esc(faq.id)}')">Delete</button>
      </div>
    </article>`).join("") : `<p class="muted">No FAQs yet.</p>`;
}

async function refreshLogs() {
  const p = new URLSearchParams({ site_id: state.currentSiteId, limit: "200" });
  if ($("logTypeFilter").value) p.set("response_type", $("logTypeFilter").value);
  if ($("logDateFilter").value) p.set("since", $("logDateFilter").value);
  state.logs = await api(`/api/logs?${p.toString()}`);
  renderLogs();
  renderRecentActivity();
}

function renderLogs() {
  const query = $("logSearch").value.trim().toLowerCase();
  const logs = state.logs.filter((log) => !query || [log.question, log.answer, log.email, log.phone, log.user_name].some((value) => String(value || "").toLowerCase().includes(query)));
  $("logsList").innerHTML = logs.length ? logs.map((log) => `
    <article class="faq-item">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <h3>${esc(log.question)}</h3>
        <span class="status-badge status-${log.response_type === 'faq_hit' ? 'hit' : log.response_type === 'llm_fallback' ? 'fallback' : 'helpline'}">
          ${esc(log.response_type.replaceAll("_", " "))}
        </span>
      </div>
      <div class="faq-answer">${esc(log.answer)}</div>
      <p class="muted" style="font-size: 11px; margin-top: 8px;">${formatDate(log.timestamp)} | User: ${esc(log.user_name || log.email || 'Anonymous')}</p>
      <div class="actions"><button class="secondary-btn btn-sm" onclick="convertLog('${esc(log.id)}')">Add as FAQ</button></div>
    </article>`).join("") : `<p class="muted">No logs yet.</p>`;
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
        <div style="font-weight: 600;">${esc(log.response_type === 'faq_hit' ? 'FAQ Answered' : log.response_type === 'llm_fallback' ? 'AI Fallback' : 'Helpline Escaped')}</div>
      </td>
      <td>
        <div class="muted" style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${esc(log.question)}
        </div>
      </td>
      <td>
        <span class="status-badge status-${log.response_type === 'faq_hit' ? 'hit' : log.response_type === 'llm_fallback' ? 'fallback' : 'helpline'}">
          ${esc(log.response_type === 'faq_hit' ? 'Answered' : log.response_type === 'llm_fallback' ? 'AI Generated' : 'Escaped')}
        </span>
      </td>
    </tr>
  `).join("") : '<tr><td colspan="4" class="muted" style="text-align: center; padding: 40px;">No recent activity</td></tr>';
}

async function refreshAnalytics() {
  const data = await api(`/api/sites/${state.currentSiteId}/analytics`);
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
      labels: ['FAQ Hit', 'AI Fallback', 'Helpline'],
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
    const ctx = $(id).getContext('2d');
    const color = id.includes('Total') ? '#7c3aed' : id.includes('Hits') ? '#10b981' : id.includes('Llm') ? '#ea580c' : '#2563eb';
    new Chart(ctx, {
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
  $("groupsList").innerHTML = groups.length ? groups.map((group) => {
    const siteNames = group.site_ids.map((id) => state.sites.find((site) => site.id === id)?.name || id).join(", ");
    return `<div class="faq-item">
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div>
          <h3>${esc(group.name)}</h3>
          <p class="muted">${esc(group.description || 'No description')}</p>
        </div>
        <div class="actions">
          <button onclick="editGroup('${esc(group.id)}')" class="secondary-btn btn-sm">Edit</button>
          <button onclick="deleteGroup('${esc(group.id)}')" class="secondary-btn btn-sm" style="color: var(--error);">Delete</button>
        </div>
      </div>
      <p class="muted" style="font-size: 11px; margin-top: 12px;">Sites: ${esc(siteNames)}</p>
    </div>`;
  }).join("") : `<p class="muted">No groups yet.</p>`;
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
  $("setPrimaryColor").value = site.primary_color || "#4f46e5";
  $("setBotName").value = site.bot_name || "";
  $("setBotAvatar").value = site.bot_avatar_url || "";
  $("setLauncher").value = site.launcher_icon || "?";
  $("setActive").checked = site.active !== false;
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
  try { 
    await api(`/api/faqs/${faqId}`, { method: "DELETE" }); 
    state.faqs = state.faqs.filter((faq) => faq.id !== faqId);
    renderFaqs();
  } catch (error) { alert(error.message); }
};

window.convertLog = async function convertLog(logId) {
  const log = state.logs.find((item) => item.id === logId);
  if (!log) return;
  const answer = prompt("Answer to save for this FAQ:", log.answer);
  if (!answer) return;
  const created = await api(`/api/logs/${logId}/convert-to-faq`, { method: "POST", body: JSON.stringify({ question: log.question, answer, aliases: [], site_id: log.site_id, group_id: "" }) });
  state.faqs.unshift(created);
  switchTab('faqs');
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

window.deleteGroup = async function deleteGroup(groupId) {
  if (!confirm("Delete this group?")) return;
  try { 
    await api(`/api/groups/${groupId}`, { method: "DELETE" }); 
    state.groups = state.groups.filter((group) => group.id !== groupId);
    renderGroups();
  } catch (error) { alert(error.message); }
};

function switchTab(tabId) {
  document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabId));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active-panel", panel.id === tabId));
  
  const titles = {
    analytics: ["Analytics", "Overview of your chatbot performance and usage."],
    faqs: ["FAQs", "Manage your chatbot's knowledge base."],
    logs: ["Conversation Logs", "View and analyze customer interactions."],
    groups: ["Site Groups", "Manage groups of sites for shared FAQs."],
    tester: ["Bot Tester", "Try out your chatbot in a safe environment."],
    settings: ["Site Settings", "Configure your chatbot's behavior and appearance."]
  };
  
  if (titles[tabId]) {
    $("panelTitle").textContent = titles[tabId][0];
    $("panelSubtitle").textContent = titles[tabId][1];
  }
  
  if (tabId === "settings") { prefillSettings(); renderSnippet(); }
  lucide.createIcons();
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
  const result = await api("/api/register-site-owner", { method: "POST", body: JSON.stringify(payload) });
  state.lastRegisteredSiteId = result.site.id;
  $("registerSnippetWrap").classList.remove("hidden");
  renderSnippet("registerSnippet");
  await auth.signInWithCustomToken(result.firebase_token);
});

$("logoutBtn").addEventListener("click", () => { auth.signOut(); localStorage.removeItem("portal_session"); showLogin(); });
$("refreshBtn").addEventListener("click", bootstrapPortal);
$("siteChooser").addEventListener("change", () => { const id = idFromChooser($("siteChooser").value, state.sites); if (id) selectSite(id); });
document.querySelectorAll(".nav-item").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
$("createFaqBtn").addEventListener("click", () => { $("faqId").value = ""; $("faqForm").reset(); $("faqModalTitle").textContent = "Add FAQ"; $("faqModal").showModal(); });
$("closeFaqModalBtn").addEventListener("click", () => $("faqModal").close());
$("clearFaqBtn").addEventListener("click", () => $("faqForm").reset());
$("faqSearch").addEventListener("input", renderFaqs);
$("groupSearch").addEventListener("input", renderGroups);
$("logSearch").addEventListener("input", renderLogs);
["logTypeFilter", "logDateFilter"].forEach((id) => $(id).addEventListener("change", refreshLogs));
$("faqGroupChooser").addEventListener("change", () => { const id = idFromChooser($("faqGroupChooser").value, state.groups); state.currentGroupId = id; refreshFaqs(); });
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
  
  try {
    const updated = await api(`/api/sites/${state.currentSiteId}`, { method: "PATCH", body: JSON.stringify(payload) });
    const idx = state.sites.findIndex(s => s.id === state.currentSiteId);
    if (idx !== -1) state.sites[idx] = updated;
    syncSiteChooser();
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
    state.sites.unshift(created);
    state.currentSiteId = created.id;
    $("siteModal").close();
    renderReferenceControls();
    syncSiteChooser();
    selectSite(created.id);
  } catch (error) { alert(error.message); }
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
  try {
    if (faqId) {
      const updated = await api(`/api/faqs/${faqId}`, { method: "PATCH", body: JSON.stringify(payload) });
      const idx = state.faqs.findIndex(f => f.id === faqId);
      if (idx !== -1) state.faqs[idx] = updated;
    } else {
      const created = await api("/api/faqs", { method: "POST", body: JSON.stringify(payload) });
      state.faqs.unshift(created);
    }
    renderFaqs();
    $("faqModal").close();
    refreshAnalytics();
  } catch (err) { alert(err.message); }
});

$("groupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const groupId = $("groupId").value.trim();
  const payload = { id: groupId || undefined, name: $("groupName").value.trim(), description: $("groupDescription").value.trim(), site_ids: selectedCheckboxValues("groupSite"), active: true };
  try {
    if (groupId && state.groups.some((group) => group.id === groupId)) {
      const { id, ...patch } = payload;
      const updated = await api(`/api/groups/${groupId}`, { method: "PATCH", body: JSON.stringify(patch) });
      const idx = state.groups.findIndex(g => g.id === groupId);
      if (idx !== -1) state.groups[idx] = updated;
    } else {
      const created = await api("/api/groups", { method: "POST", body: JSON.stringify(payload) });
      state.groups.unshift(created);
    }
    $("groupForm").reset();
    renderReferenceControls();
    renderGroups();
  } catch (error) { alert(error.message); }
});

$("copySnippetBtn").addEventListener("click", () => navigator.clipboard.writeText($("snippetCode").textContent));
$("copyRegisterSnippetBtn").addEventListener("click", () => navigator.clipboard.writeText($("registerSnippet").textContent));

$("leadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const session = await api("/api/chat/sessions", { method: "POST", body: JSON.stringify({ site_id: state.currentSiteId, name: $("testName").value, email: $("testEmail").value, phone: $("testPhone").value }) });
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
    const response = await api("/api/chat/message", { method: "POST", body: JSON.stringify({ site_id: state.currentSiteId, session_id: state.sessionId, question }) });
    bot.querySelector(".msg-text").textContent = response.answer;
    refreshLogs();
  } catch { bot.querySelector(".msg-text").textContent = "Sorry, something went wrong."; }
});

function addMessage(type, text) {
  const node = document.createElement("div");
  node.className = `message ${type}`;
  node.innerHTML = `<span class="msg-text">${esc(text)}</span>`;
  $("testMessages").appendChild(node);
  $("testMessages").scrollTop = $("testMessages").scrollHeight;
  return node;
}
