// ──────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────
const state = {
  sites: [],       // sites the logged-in user can access
  currentSiteId: "",
  faqs: [],
  logs: [],
  sessionId: "",
  principal: null,
};

const $ = (id) => document.getElementById(id);

// ──────────────────────────────────────────────────
// Firebase — copy your config from the Admin panel
// ──────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
};

try {
  firebase.initializeApp(firebaseConfig);
} catch (e) {
  console.warn("Firebase config missing or already initialised.", e);
}

// Watch auth state
firebase.auth().onAuthStateChanged(async (user) => {
  if (user) {
    const token = await user.getIdToken(/* forceRefresh */ true);
    localStorage.setItem("portalFirebaseToken", token);
    $("userEmail").textContent = user.email;
    $("logoutBtn").style.display = "inline-block";
    hideLogin();
    await bootstrapPortal();
  } else {
    localStorage.removeItem("portalFirebaseToken");
    $("userEmail").textContent = "";
    $("logoutBtn").style.display = "none";
    showLogin();
  }
});

// ──────────────────────────────────────────────────
// Auth helpers
// ──────────────────────────────────────────────────
function authHeaders(extra = {}) {
  const token = localStorage.getItem("portalFirebaseToken");
  const apiKey = localStorage.getItem("portalApiKey");
  const headers = { ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  else if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  
  if (!headers["Content-Type"] && !(extra instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

function showLogin() {
  $("loginOverlay").classList.add("active");
  $("mainLayout").style.display = "none";
}

function hideLogin() {
  $("loginOverlay").classList.remove("active");
  $("mainLayout").style.display = "grid";
}

function setStatus(text) { $("statusText").textContent = text; }
function setLoading(on)   { $("globalLoading").style.display = on ? "inline-block" : "none"; }

// ──────────────────────────────────────────────────
// API wrapper
// ──────────────────────────────────────────────────
async function api(path, options = {}) {
  setLoading(true);
  const headers = authHeaders(options.headers || {});
  if (options.body instanceof FormData) delete headers["Content-Type"];
  try {
    const res = await fetch(path, { ...options, headers });
    if (res.status === 401) { showLogin(); throw new Error("Session expired. Please log in again."); }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed: ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  } finally {
    setLoading(false);
  }
}

// ──────────────────────────────────────────────────
// Bootstrap — called right after sign-in
// ──────────────────────────────────────────────────
async function bootstrapPortal() {
  setStatus("Loading…");
  try {
    const [me, sites] = await Promise.all([api("/api/me"), api("/api/sites")]);
    state.principal = me;
    state.sites = sites;

    if (!state.sites.length) {
      // User exists in Firebase but no sites assigned
      showNoAccess();
      return;
    }

    // Default to first site
    state.currentSiteId = state.currentSiteId || state.sites[0].id;
    renderSiteSwitcher();
    renderSnippet();
    setStatus(`${me.email} | ${me.role}`);
    await Promise.all([refreshFaqs(), refreshLogs(), refreshAnalytics()]);
    prefillSettings();
    updateTesterSiteName();
  } catch (err) {
    setStatus("Error: " + err.message);
  }
}

// ──────────────────────────────────────────────────
// Site switcher
// ──────────────────────────────────────────────────
function renderSiteSwitcher() {
  if (state.sites.length === 1) {
    // Single site → show fixed badge, hide <select>
    const site = state.sites[0];
    $("siteBadgeText").textContent = site.name;
    $("siteDot").style.background = site.primary_color || "var(--brand)";
    $("siteBadge").style.display = "inline-flex";
    $("siteSelect").style.display = "none";
  } else {
    // Multiple sites → show <select> switcher
    $("siteBadge").style.display = "none";
    const sel = $("siteSelect");
    sel.innerHTML = state.sites
      .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)
      .join("");
    sel.value = state.currentSiteId;
    sel.style.display = "inline-block";
  }
}

$("siteSelect").addEventListener("change", async (e) => {
  state.currentSiteId = e.target.value;
  state.sessionId = "";
  renderSnippet();
  updateTesterSiteName();
  await Promise.all([refreshFaqs(), refreshLogs(), refreshAnalytics()]);
  prefillSettings();
});

// ──────────────────────────────────────────────────
// No-access fallback
// ──────────────────────────────────────────────────
function showNoAccess() {
  $("mainLayout").style.display = "grid";
  document.querySelector(".content").innerHTML = `
    <div class="no-access">
      <h2>No Site Access</h2>
      <p>Your account has not been assigned to any site yet.</p>
      <p>Please contact your system administrator to get access.</p>
    </div>`;
}

// ──────────────────────────────────────────────────
// Data refreshes
// ──────────────────────────────────────────────────
async function refreshFaqs() {
  if (!state.currentSiteId) return;
  state.faqs = await api(`/api/faqs?site_id=${encodeURIComponent(state.currentSiteId)}`);
  renderFaqs();
}

async function refreshLogs() {
  if (!state.currentSiteId) return;
  const p = new URLSearchParams({ site_id: state.currentSiteId, limit: "200" });
  if ($("fallbackOnly").checked) p.set("fallback_only", "true");
  state.logs = await api(`/api/logs?${p.toString()}`);
  renderLogs();
}

async function refreshAnalytics() {
  if (!state.currentSiteId) return;
  try {
    const data = await api(`/api/sites/${state.currentSiteId}/analytics`);
    $("statTotal").textContent       = data.total_queries;
    $("statHitRate").textContent     = `${data.hit_rate}%`;
    $("statFaqHits").textContent     = `${data.faq_hits} hits`;
    $("statLlmRate").textContent     = `${data.llm_rate}%`;
    $("statLlmHits").textContent     = `${data.llm_fallbacks} fallbacks`;
    $("statHelplineRate").textContent= `${data.helpline_rate}%`;
    $("topFaqsList").innerHTML = data.top_faqs.length
      ? data.top_faqs.map((faq) => `
          <div class="row">
            <p class="row-title" style="margin:0; font-weight:bold;">${esc(faq.question)}</p>
            <div class="meta" style="font-size:1.1rem; font-weight:bold; color:var(--brand);">
              ${faq.count} <span style="font-size:0.8rem; font-weight:normal;">uses</span>
            </div>
            <div></div>
          </div>`).join("")
      : `<p style="color:var(--muted); padding:1rem;">No FAQs used yet.</p>`;
  } catch (e) { console.error("Analytics error:", e); }
}

// ──────────────────────────────────────────────────
// Renderers
// ──────────────────────────────────────────────────
function esc(v = "") {
  return String(v)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function renderFaqs() {
  $("faqsList").innerHTML = state.faqs.length
    ? state.faqs.map((faq) => `
        <article class="faq-item">
          <div>
            <h3>${esc(faq.question)}</h3>
            <p class="meta">${esc(faq.id)}</p>
          </div>
          <div class="faq-answer">${esc(faq.answer)}</div>
          <p class="meta">Aliases: ${esc((faq.aliases || []).join(", ") || "none")}</p>
          <div class="actions">
            <button class="ghost" onclick="editFaq('${faq.id}')">Edit</button>
            <button class="danger" onclick="deleteFaq('${faq.id}')">Delete</button>
          </div>
        </article>`).join("")
    : `<p style="color:var(--muted); padding:1rem;">No FAQs yet. Add one above!</p>`;
}

function renderLogs() {
  $("logsList").innerHTML = state.logs.length
    ? state.logs.map((log) => `
        <article class="log-item">
          <div>
            <h3>${esc(log.question)}</h3>
            <p class="meta">
              ${esc(log.response_type)} | ${esc(new Date(log.timestamp).toLocaleString())}
              | ${esc(log.user_name || "anonymous")}
            </p>
          </div>
          <div class="log-answer">${esc(log.answer)}</div>
          <p class="meta">
            ${esc(log.email || "no email")} | ${esc(log.phone || "no phone")}
            | distance ${log.vector_distance ?? "n/a"}
          </p>
          <div class="actions">
            <button class="secondary" onclick="convertLog('${log.id}')">Add as FAQ</button>
          </div>
        </article>`).join("")
    : `<p style="color:var(--muted); padding:1rem;">No logs yet.</p>`;
}

// ──────────────────────────────────────────────────
// FAQ CRUD
// ──────────────────────────────────────────────────
window.editFaq = function (faqId) {
  const faq = state.faqs.find((f) => f.id === faqId);
  if (!faq) return;
  $("faqId").value       = faq.id;
  $("faqQuestion").value = faq.question;
  $("faqAliases").value  = (faq.aliases || []).join("\n");
  $("faqAnswer").value   = faq.answer;
  switchTab("faqs");
  $("faqQuestion").focus();
};

window.deleteFaq = async function (faqId) {
  if (!confirm("Delete this FAQ?")) return;
  const prev = [...state.faqs];
  state.faqs = state.faqs.filter((f) => f.id !== faqId);
  renderFaqs();
  try {
    await api(`/api/faqs/${faqId}`, { method: "DELETE" });
    refreshAnalytics();
  } catch (e) {
    state.faqs = prev;
    renderFaqs();
    alert("Delete failed: " + e.message);
  }
};

window.convertLog = async function (logId) {
  const log = state.logs.find((l) => l.id === logId);
  if (!log) return;
  const answer = prompt("Answer to save for this FAQ:", log.answer);
  if (!answer) return;
  await api(`/api/logs/${logId}/convert-to-faq`, {
    method: "POST",
    body: JSON.stringify({ answer, site_ids: [log.site_id], aliases: [] }),
  });
  await Promise.all([refreshFaqs(), refreshLogs()]);
};

$("faqForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const faqId   = $("faqId").value.trim();
  const payload = {
    question:  $("faqQuestion").value.trim(),
    answer:    $("faqAnswer").value.trim(),
    aliases:   $("faqAliases").value.split("\n").map((s) => s.trim()).filter(Boolean),
    site_ids:  [state.currentSiteId],
    group_ids: [],
    active:    true,
  };
  try {
    if (faqId) {
      const prev  = [...state.faqs];
      const idx   = state.faqs.findIndex((f) => f.id === faqId);
      if (idx !== -1) { state.faqs[idx] = { ...state.faqs[idx], ...payload }; renderFaqs(); }
      try {
        const updated = await api(`/api/faqs/${faqId}`, { method: "PATCH", body: JSON.stringify(payload) });
        if (idx !== -1) state.faqs[idx] = updated;
        renderFaqs();
      } catch (err) {
        state.faqs = prev; renderFaqs();
        alert("Update failed: " + err.message); return;
      }
    } else {
      const created = await api("/api/faqs", { method: "POST", body: JSON.stringify(payload) });
      state.faqs.unshift(created);
      renderFaqs();
    }
    clearFaqForm();
    refreshAnalytics();
  } catch (err) {
    alert("Save failed: " + err.message);
  }
});

function clearFaqForm() {
  $("faqId").value       = "";
  $("faqQuestion").value = "";
  $("faqAliases").value  = "";
  $("faqAnswer").value   = "";
}
$("clearFaqBtn").addEventListener("click", clearFaqForm);

// ── CSV Import ──
$("importCsvBtn").addEventListener("click", () => {
  if (!state.currentSiteId) { alert("No site selected."); return; }
  $("csvFile").click();
});

$("csvFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !state.currentSiteId) return;
  const formData = new FormData();
  formData.append("file", file);
  try {
    setStatus("Uploading CSV…");
    $("importCsvBtn").disabled = true;
    const result = await api(`/api/sites/${state.currentSiteId}/faqs/upload`, {
      method: "POST", body: formData, headers: {},
    });
    if (result.task_id) {
      let done = false;
      while (!done) {
        setStatus("Queued: waiting to start…");
        await new Promise((r) => setTimeout(r, 2000));
        const task = await api(`/api/tasks/${result.task_id}`);
        if (task.status === "processing") {
          setStatus(`Indexing: ${task.processed_items} / ${task.total_items} rows…`);
        } else if (task.status === "completed") {
          setStatus(`Done: indexed ${task.total_items} rows.`);
          alert("Import completed!");
          done = true;
        } else if (task.status === "failed") {
          setStatus("Import failed.");
          alert("Import failed: " + task.error_message);
          done = true;
        }
      }
    }
    await refreshFaqs();
  } catch (err) {
    alert("Import failed: " + err.message);
  } finally {
    e.target.value = "";
    $("importCsvBtn").disabled = false;
    setStatus("Ready");
  }
});

// ──────────────────────────────────────────────────
// Site Settings
// ──────────────────────────────────────────────────
function prefillSettings() {
  const site = state.sites.find((s) => s.id === state.currentSiteId);
  if (!site) return;
  $("setHelpline").value      = site.helpline_number || "";
  $("setWelcome").value       = site.welcome_message || "";
  $("setFallback").value      = site.fallback_message || "";
  $("setAcceptDist").value    = site.faq_accept_distance ?? "";
  $("setCandidateDist").value = site.llm_candidate_distance ?? "";
  $("setOrigins").value       = (site.allowed_origins || []).join(", ");
  $("setPrimaryColor").value  = site.primary_color || "#22c55e";
  $("setBotName").value       = site.bot_name || "";
  $("setBotAvatar").value     = site.bot_avatar_url || "";
  $("setLauncher").value      = site.launcher_icon || "?";
  $("setActive").checked      = site.active !== false;
}

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    helpline_number:      $("setHelpline").value.trim(),
    welcome_message:      $("setWelcome").value.trim(),
    fallback_message:     $("setFallback").value.trim(),
    allowed_origins:      $("setOrigins").value.split(",").map((s) => s.trim()).filter(Boolean),
    primary_color:        $("setPrimaryColor").value,
    bot_name:             $("setBotName").value.trim() || "Support Bot",
    bot_avatar_url:       $("setBotAvatar").value.trim(),
    launcher_icon:        $("setLauncher").value.trim() || "?",
    active:               $("setActive").checked,
  };
  if ($("setAcceptDist").value !== "")
    payload.faq_accept_distance = Number($("setAcceptDist").value);
  if ($("setCandidateDist").value !== "")
    payload.llm_candidate_distance = Number($("setCandidateDist").value);
  try {
    await api(`/api/sites/${state.currentSiteId}`, { method: "PATCH", body: JSON.stringify(payload) });
    // Refresh local site cache
    const updated = await api(`/api/sites/${state.currentSiteId}`);
    const idx = state.sites.findIndex((s) => s.id === state.currentSiteId);
    if (idx !== -1) state.sites[idx] = updated;
    renderSiteSwitcher();
    alert("Settings saved!");
  } catch (err) {
    alert("Save failed: " + err.message);
  }
});

// ──────────────────────────────────────────────────
// Widget Snippet
// ──────────────────────────────────────────────────
function renderSnippet() {
  if (!state.currentSiteId) return;
  const origin = window.location.origin;
  const code =
`<!-- FAQ Chatbot Widget -->
<script
  src="${origin}/widget/chatbot-widget.js"
  data-site-id="${state.currentSiteId}"
  data-api-base="${origin}"
  data-collect-lead="true">
<\/script>`;
  $("snippetCode").textContent = code;
}

$("copySnippetBtn").addEventListener("click", () => {
  navigator.clipboard.writeText($("snippetCode").textContent).then(() => {
    $("copySnippetBtn").textContent = "Copied!";
    setTimeout(() => ($("copySnippetBtn").textContent = "Copy"), 2000);
  });
});

// ──────────────────────────────────────────────────
// Tester
// ──────────────────────────────────────────────────
function updateTesterSiteName() {
  const site = state.sites.find((s) => s.id === state.currentSiteId);
  $("testerSiteName").textContent = site?.name || "No site selected";
}

$("leadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.currentSiteId) { alert("No site selected."); return; }
  const btn = $("startSessionBtn");
  btn.disabled = true; btn.textContent = "Starting…";
  try {
    const session = await fetch("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: state.currentSiteId,
        name:    $("testName").value,
        email:   $("testEmail").value,
        phone:   $("testPhone").value,
      }),
    }).then((r) => r.json());
    state.sessionId = session.id;
    const site = state.sites.find((s) => s.id === state.currentSiteId);
    addMessage("bot", `Session started! Ask me anything about ${site?.name || state.currentSiteId}.`);
    $("leadForm").classList.add("hidden");
    $("testForm").classList.remove("hidden");
    $("testQuestion").focus();
  } catch (err) {
    addMessage("bot", "Could not start session. Please try again.");
  } finally {
    btn.disabled = false; btn.textContent = "Start Session";
  }
});

$("testForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = $("testQuestion").value.trim();
  if (!question || !state.currentSiteId) return;
  addMessage("user", question);
  $("testQuestion").value = "";
  const sendBtn = $("testSendBtn");
  sendBtn.disabled = true;
  const thinkingNode = addTypingIndicator();
  let botNode = null, botText = "", metadata = {};
  try {
    const res = await fetch("/api/chat/message/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id:    state.currentSiteId,
        session_id: state.sessionId,
        question,
        name:  $("testName").value,
        email: $("testEmail").value,
        phone: $("testPhone").value,
      }),
    });
    if (!res.ok || !res.body) throw new Error("Stream failed");
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === "metadata") { metadata = ev; state.sessionId = ev.session_id || state.sessionId; }
          if (ev.type === "token") {
            if (!botNode) { thinkingNode.remove(); botNode = addMessage("bot", ""); }
            botText += ev.text || "";
            botNode.querySelector(".msg-text").textContent = botText;
            $("testMessages").scrollTop = $("testMessages").scrollHeight;
          }
        } catch {}
      }
    }
    if (botNode) {
      const badge = document.createElement("span");
      badge.style.cssText = "display:block;font-size:0.72rem;margin-top:5px;opacity:0.5;text-transform:uppercase;letter-spacing:0.05em;";
      badge.textContent = (metadata.response_type || "faq_hit").replaceAll("_", " ");
      botNode.appendChild(badge);
    } else {
      thinkingNode.remove();
      addMessage("bot", "No response received.");
    }
    refreshLogs();
  } catch (err) {
    if (thinkingNode.isConnected) thinkingNode.remove();
    if (!botNode) addMessage("bot", "Sorry, something went wrong. Please try again.");
  } finally {
    sendBtn.disabled = false;
    $("testQuestion").focus();
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

function addTypingIndicator() {
  const node = document.createElement("div");
  node.className = "message bot";
  node.innerHTML = `<span class="msg-text" style="opacity:0.6;font-style:italic;">Thinking</span>
    <span style="display:inline-flex;gap:3px;vertical-align:middle;margin-left:6px;">
      <span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:blink 1.2s 0s infinite;display:inline-block"></span>
      <span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:blink 1.2s 0.2s infinite;display:inline-block"></span>
      <span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:blink 1.2s 0.4s infinite;display:inline-block"></span>
    </span>`;
  $("testMessages").appendChild(node);
  $("testMessages").scrollTop = $("testMessages").scrollHeight;
  return node;
}

// ──────────────────────────────────────────────────
// Tab navigation
// ──────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.tab === tabId)
  );
  document.querySelectorAll(".panel").forEach((panel) =>
    panel.classList.toggle("active-panel", panel.id === tabId)
  );
  // Lazy-load snippet when tab is opened
  if (tabId === "snippet") renderSnippet();
  if (tabId === "settings") prefillSettings();
}

document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => switchTab(btn.dataset.tab))
);

// ──────────────────────────────────────────────────
// Login form
// ──────────────────────────────────────────────────
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").textContent = "Signing in…";
  try {
    await firebase.auth().signInWithEmailAndPassword(
      $("loginEmail").value,
      $("loginPassword").value
    );
    $("loginError").textContent = "";
  } catch (err) {
    $("loginError").textContent = err.message;
  }
});

$("logoutBtn").addEventListener("click", () => {
  firebase.auth().signOut();
  localStorage.removeItem("portalFirebaseToken");
  localStorage.removeItem("portalApiKey");
  showLogin();
});

$("devLoginBtn").addEventListener("click", async () => {
  const key = $("devApiKey").value;
  localStorage.setItem("portalApiKey", key || "");
  localStorage.removeItem("portalFirebaseToken");
  hideLogin();
  await bootstrapPortal();
});

$("refreshBtn").addEventListener("click", bootstrapPortal);
$("fallbackOnly").addEventListener("change", refreshLogs);
