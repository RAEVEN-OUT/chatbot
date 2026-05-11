const state = {
  sites: [],
  groups: [],
  faqs: [],
  logs: [],
  currentSiteId: "",
  sessionId: "",
  principal: null,
};

const $ = (id) => document.getElementById(id);

// --- FIREBASE CONFIGURATION ---
// TODO: Replace with your actual Firebase config from the Google Cloud Console
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
};

try {
  firebase.initializeApp(firebaseConfig);
} catch (error) {
  console.warn("Firebase is not fully configured. You can still use the Developer API Key.", error);
}

// Watch for authentication state changes
firebase.auth().onAuthStateChanged(async (user) => {
  if (user) {
    const token = await user.getIdToken();
    localStorage.setItem("adminFirebaseToken", token);
    $("userEmail").textContent = user.email;
    $("logoutBtn").style.display = "inline-block";
    hideLogin();
    refreshAll();
  } else {
    localStorage.removeItem("adminFirebaseToken");
    $("userEmail").textContent = "";
    $("logoutBtn").style.display = "none";
    showLogin();
  }
});

function adminHeaders(extra = {}) {
  const firebaseToken = localStorage.getItem("adminFirebaseToken");
  const apiKey = localStorage.getItem("adminApiKey");
  
  const headers = { ...extra };
  
  if (firebaseToken) {
    headers["Authorization"] = `Bearer ${firebaseToken}`;
  } else if (apiKey) {
    headers["x-admin-api-key"] = apiKey;
  }

  // Default to JSON if not specified and not FormData
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

function setGlobalLoading(isLoading) {
  $("globalLoading").style.display = isLoading ? "inline-block" : "none";
}

async function api(path, options = {}) {
  setGlobalLoading(true);
  const headers = adminHeaders(options.headers || {});
  
  // If the body is FormData, we MUST NOT set Content-Type manually
  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
  }

  try {
    const response = await fetch(path, {
      ...options,
      headers,
    });
    if (response.status === 401) {
      showLogin();
      throw new Error("Unauthorized. Please log in.");
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed: ${response.status}`);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  } finally {
    setGlobalLoading(false);
  }
}

function setStatus(text) {
  $("statusText").textContent = text;
}

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function currentSite() {
  return state.sites.find((site) => site.id === state.currentSiteId);
}

async function refreshAll() {
  setStatus("Refreshing...");
  const [me, sites, groups] = await Promise.all([
    api("/api/me"),
    api("/api/sites"),
    api("/api/groups")
  ]);
  state.principal = me;
  state.sites = sites;
  state.groups = groups;

  if (!state.currentSiteId && state.sites.length) {
    state.currentSiteId = state.sites[0].id;
  }
  renderSiteSelect();
  renderSites();
  renderGroups();
  renderUserSites();
  renderTargetControls();
  setStatus(`${state.sites.length} sites, ${state.groups.length} groups | ${me.role}`);

  // Fire secondary refreshes in background — don't block the UI
  refreshFaqs();
  refreshLogs();
  refreshAnalytics();
}

async function refreshFaqs() {
  const mode = document.querySelector("input[name='targetMode']:checked")?.value || "current";
  
  let query = "";
  if (mode === "current" && state.currentSiteId) {
    query = `?site_id=${encodeURIComponent(state.currentSiteId)}`;
  } else if (mode === "group" && $("faqGroupSelect").value) {
    query = `?group_id=${encodeURIComponent($("faqGroupSelect").value)}`;
  }
  // For 'multiple', we fetch all and filter client-side

  // Clear list while loading to prevent "stale" data confusion
  state.faqs = [];
  renderFaqs();

  const faqs = await api(`/api/faqs${query}`);
  
  if (mode === "multiple") {
    const checkedSites = selectedCheckboxValues("faqSite");
    
    // Find groups that include any of the checked sites
    const activeGroupIds = state.groups
      .filter(g => g.site_ids.some(siteId => checkedSites.includes(siteId)))
      .map(g => g.id);

    state.faqs = faqs.filter(faq => 
      (faq.site_ids && faq.site_ids.some(id => checkedSites.includes(id))) ||
      (faq.group_ids && faq.group_ids.some(id => activeGroupIds.includes(id)))
    );
  } else {
    state.faqs = faqs;
  }
  
  renderFaqs();
}

async function refreshLogs() {
  const params = new URLSearchParams();
  if (state.currentSiteId) params.set("site_id", state.currentSiteId);
  if ($("fallbackOnly").checked) params.set("fallback_only", "true");
  params.set("limit", "200");
  state.logs = state.currentSiteId ? await api(`/api/logs?${params.toString()}`) : [];
  renderLogs();
}

async function refreshAnalytics() {
  if (!state.currentSiteId) return;
  try {
    const data = await api(`/api/sites/${state.currentSiteId}/analytics`);
    $("statTotal").textContent = data.total_queries;
    $("statHitRate").textContent = `${data.hit_rate}%`;
    $("statFaqHits").textContent = `${data.faq_hits} hits`;
    $("statLlmRate").textContent = `${data.llm_rate}%`;
    $("statLlmHits").textContent = `${data.llm_fallbacks} fallbacks`;
    $("statHelplineRate").textContent = `${data.helpline_rate}%`;
    
    $("topFaqsList").innerHTML = data.top_faqs.length ? data.top_faqs.map(faq => `
      <div class="row">
        <div>
          <p class="row-title" style="margin: 0; font-weight: bold;">${escapeHtml(faq.question)}</p>
        </div>
        <div class="meta" style="font-size: 1.2rem; font-weight: bold; color: var(--primary);">
          ${faq.count} <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-muted);">uses</span>
        </div>
      </div>
    `).join("") : "<p style='padding: 1rem; color: var(--text-muted);'>No FAQs used yet.</p>";
  } catch (error) {
    console.error("Failed to load analytics:", error);
  }
}

function renderSiteSelect() {
  $("siteSelect").innerHTML = state.sites
    .map((site) => `<option value="${escapeHtml(site.id)}">${escapeHtml(site.name)}</option>`)
    .join("");
  $("siteSelect").value = state.currentSiteId;
}

function renderSites() {
  $("sitesList").innerHTML = state.sites
    .map(
      (site) => `
        <div class="row">
          <div>
            <p class="row-title">${escapeHtml(site.name)}</p>
            <p class="meta">${escapeHtml(site.id)} | ${escapeHtml(site.domain || "no domain")}</p>
            <div style="display: flex; gap: 5px; margin-top: 5px;">
              <span style="width: 12px; height: 12px; border-radius: 50%; background: ${site.primary_color || '#22c55e'}; border: 1px solid var(--border);"></span>
              <span class="meta">${escapeHtml(site.bot_name || "Support Bot")}</span>
            </div>
          </div>
          <div class="meta">${escapeHtml(site.helpline_number)}</div>
          <div class="actions">
            <button class="ghost" onclick="selectSite('${site.id}')">Select</button>
            <button class="ghost" onclick="reindexSite('${site.id}', this)" title="Re-sync vectors if you changed embedding models">Repair Vectors</button>
            <button class="secondary" onclick="editSite('${site.id}')">Edit</button>
            <button class="danger" onclick="deleteSite('${site.id}')">Delete</button>
          </div>
        </div>
      `
    )
    .join("");
}

function renderGroups() {
  $("groupSiteChecks").innerHTML = siteCheckboxes("groupSite", []);
  $("groupsList").innerHTML = state.groups
    .map((group) => {
      const siteNames = group.site_ids
        .map((siteId) => state.sites.find((site) => site.id === siteId)?.name || siteId)
        .join(", ");
      return `
        <div class="row">
          <div>
            <p class="row-title">${escapeHtml(group.name)}</p>
            <p class="meta">${escapeHtml(group.id)}</p>
          </div>
          <div class="meta">${escapeHtml(siteNames || "No sites")}</div>
          <div class="actions">
            <button class="secondary" onclick="editGroup('${group.id}')">Edit</button>
            <button class="danger" onclick="deleteGroup('${group.id}')">Delete</button>
          </div>
        </div>
      `;
    })
    .join("");
}
function siteCheckboxes(name, selected) {
  return state.sites
    .map(
      (site) => `
        <label>
          <input name="${name}" type="checkbox" value="${escapeHtml(site.id)}" ${selected.includes(site.id) ? "checked" : ""} />
          ${escapeHtml(site.name)}
        </label>
      `
    )
    .join("");
}

function renderUserSites() {
  $("userSiteChecks").innerHTML = siteCheckboxes("userSite", []);
}

function renderTargetControls(selectedSites = [], selectedGroup = "") {
  $("faqSiteChecks").innerHTML = siteCheckboxes("faqSite", selectedSites);
  $("faqGroupSelect").innerHTML = state.groups
    .map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
    .join("");
  if (selectedGroup) {
    $("faqGroupSelect").value = selectedGroup;
  }
  
  // Attach listeners for dynamic filtering
  $("faqGroupSelect").addEventListener("change", refreshFaqs);
  document.querySelectorAll("input[name='faqSite']").forEach(el => 
    el.addEventListener("change", refreshFaqs)
  );
}

function renderFaqs() {
  $("faqsList").innerHTML = state.faqs
    .map(
      (faq) => `
        <article class="faq-item">
          <div>
            <h3>${escapeHtml(faq.question)}</h3>
            <p class="meta">${escapeHtml(faq.owner_type)} | ${escapeHtml(faq.id)}</p>
          </div>
          <div class="faq-answer">${escapeHtml(faq.answer)}</div>
          <p class="meta">Aliases: ${escapeHtml((faq.aliases || []).join(", ") || "none")}</p>
          <div class="actions">
            <button class="secondary" onclick="editFaq('${faq.id}')">Edit</button>
            <button class="danger" onclick="deleteFaq('${faq.id}')">Delete</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderLogs() {
  $("logsList").innerHTML = state.logs
    .map(
      (log) => `
        <article class="log-item">
          <div>
            <h3>${escapeHtml(log.question)}</h3>
            <p class="meta">
              ${escapeHtml(log.response_type)} | ${escapeHtml(new Date(log.timestamp).toLocaleString())}
              | ${escapeHtml(log.user_name || "anonymous")}
            </p>
          </div>
          <div class="log-answer">${escapeHtml(log.answer)}</div>
          <p class="meta">
            ${escapeHtml(log.email || "no email")} | ${escapeHtml(log.phone || "no phone")}
            | distance ${log.vector_distance ?? "n/a"}
          </p>
          <div class="actions">
            <button class="secondary" onclick="convertLog('${log.id}')">Add as FAQ</button>
          </div>
        </article>
      `
    )
    .join("");
}

window.selectSite = async function selectSite(siteId) {
  state.currentSiteId = siteId;
  state.sessionId = "";
  $("siteSelect").value = siteId;

  // Clear tester panel — conversations are site-scoped
  $("testMessages").innerHTML = "";
  $("leadForm").classList.remove("hidden");
  $("testForm").classList.add("hidden");
  $("leadForm").reset();
  const siteName = state.sites.find(s => s.id === siteId)?.name || siteId;
  $("testerSiteName").textContent = siteName;
  addMessage("bot", `Testing: ${siteName}. Fill in your details below to start.`);

  // Fire all refreshes in parallel without blocking the UI swap
  refreshFaqs();
  refreshLogs();
  refreshAnalytics();
};

window.reindexSite = async function reindexSite(site_id, btn) {
  if (!confirm("This will re-calculate embeddings for ALL FAQs in this site. Use this if you changed your GEMINI_EMBEDDING_MODEL setting. Continue?")) return;
  const originalText = btn.textContent;
  btn.textContent = "Requesting...";
  btn.disabled = true;
  try {
    const result = await api(`/api/sites/${site_id}/reindex`, { method: "POST" });
    
    // Poll for status
    let isDone = false;
    while (!isDone) {
      const task = await api(`/api/tasks/${result.task_id}`);
      if (task.status === "processing") {
        btn.textContent = `Repairing (${task.processed_items}/${task.total_items})...`;
      } else if (task.status === "completed") {
        alert(`Successfully reindexed ${task.total_items} FAQs!`);
        isDone = true;
      } else if (task.status === "failed") {
        alert("Repair failed: " + task.error_message);
        isDone = true;
      }
      if (!isDone) await new Promise(r => setTimeout(r, 2000));
    }
  } catch (error) {
    alert("Repair request failed: " + error.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
    await refreshAll();
  }
};

window.editSite = function editSite(siteId) {
  const site = state.sites.find((item) => item.id === siteId);
  if (!site) return;
  $("siteId").value = site.id;
  $("siteId").readOnly = true;
  $("siteName").value = site.name;
  $("siteDomain").value = site.domain || "";
  $("siteHelpline").value = site.helpline_number;
  $("siteWelcome").value = site.welcome_message || "";
  $("siteFallback").value = site.fallback_message || "";
  $("siteAcceptDistance").value = site.faq_accept_distance;
  $("siteCandidateDistance").value = site.llm_candidate_distance;
  $("siteActive").checked = site.active;
  $("siteAllowedOrigins").value = (site.allowed_origins || []).join(", ");
  $("sitePrimaryColor").value = site.primary_color || "#22c55e";
  $("siteBotName").value = site.bot_name || "";
  $("siteBotAvatar").value = site.bot_avatar_url || "";
  $("siteLauncherIcon").value = site.launcher_icon || "?";
  switchTab("sites");
};

window.deleteSite = async function deleteSite(siteId) {
  if (!confirm("Delete this site?")) return;
  await api(`/api/sites/${siteId}`, { method: "DELETE" });
  state.currentSiteId = "";
  await refreshAll();
};

window.editGroup = function editGroup(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  $("groupId").value = group.id;
  $("groupName").value = group.name;
  $("groupDescription").value = group.description || "";
  $("groupSiteChecks").innerHTML = siteCheckboxes("groupSite", group.site_ids || []);
  switchTab("groups");
};

window.deleteGroup = async function deleteGroup(groupId) {
  if (!confirm("Delete this group?")) return;
  await api(`/api/groups/${groupId}`, { method: "DELETE" });
  await refreshAll();
};

window.editFaq = function editFaq(faqId) {
  const faq = state.faqs.find((item) => item.id === faqId);
  if (!faq) return;
  $("faqId").value = faq.id;
  $("faqQuestion").value = faq.question;
  $("faqAliases").value = (faq.aliases || []).join("\n");
  $("faqAnswer").value = faq.answer;
  const mode = faq.group_ids?.length ? "group" : faq.site_ids?.length > 1 ? "multiple" : "current";
  document.querySelector(`input[name="targetMode"][value="${mode}"]`).checked = true;
  renderTargetControls(faq.site_ids || [], faq.group_ids?.[0] || "");
  updateTargetMode();
};

window.deleteFaq = async function deleteFaq(faqId) {
  if (!confirm("Delete this FAQ?")) return;
  
  const previousFaqs = [...state.faqs];
  state.faqs = state.faqs.filter(f => f.id !== faqId);
  renderFaqs(); // Optimistic UI: Remove immediately
  
  try {
    await api(`/api/faqs/${faqId}`, { method: "DELETE" });
    refreshAnalytics(); // Refresh analytics in background
  } catch (error) {
    state.faqs = previousFaqs;
    renderFaqs(); // Revert on failure
    alert("Delete failed: " + error.message);
  }
};

window.convertLog = async function convertLog(logId) {
  const log = state.logs.find((item) => item.id === logId);
  if (!log) return;
  const answer = prompt("Answer to save for this FAQ:", log.answer);
  if (!answer) return;
  await api(`/api/logs/${logId}/convert-to-faq`, {
    method: "POST",
    body: JSON.stringify({ answer, site_ids: [log.site_id], aliases: [] }),
  });
  await refreshFaqs();
  await refreshLogs();
};

function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabId);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active-panel", panel.id === tabId);
  });
}

function updateTargetMode() {
  const mode = document.querySelector("input[name='targetMode']:checked").value;
  $("multiSiteTarget").classList.toggle("hidden", mode !== "multiple");
  $("groupTarget").classList.toggle("hidden", mode !== "group");
  refreshFaqs(); // Instantly update the list when mode switches
}

function selectedCheckboxValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

// Auth Listeners
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("loginEmail").value;
  const password = $("loginPassword").value;
  $("loginError").textContent = "Signing in...";
  try {
    await firebase.auth().signInWithEmailAndPassword(email, password);
    $("loginError").textContent = "";
  } catch (error) {
    $("loginError").textContent = error.message;
  }
});

$("useKeyBtn").addEventListener("click", () => {
  const key = $("fallbackKey").value;
  localStorage.setItem("adminApiKey", key || "");
  localStorage.removeItem("adminFirebaseToken");
  hideLogin();
  refreshAll();
});

$("logoutBtn").addEventListener("click", () => {
  firebase.auth().signOut();
  localStorage.removeItem("adminApiKey");
  localStorage.removeItem("adminFirebaseToken");
  showLogin();
});

$("seedBtn").addEventListener("click", async () => {
  await api("/api/demo/seed", { method: "POST", body: "{}" });
  await refreshAll();
});

$("refreshBtn").addEventListener("click", refreshAll);
$("siteSelect").addEventListener("change", (event) => selectSite(event.target.value));
$("fallbackOnly").addEventListener("change", refreshLogs);

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

document.querySelectorAll("input[name='targetMode']").forEach((input) => {
  input.addEventListener("change", updateTargetMode);
});

$("siteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("statusText");
  try {
    const siteId = $("siteId").value.trim();
    const payload = {
      name: $("siteName").value.trim(),
      domain: $("siteDomain").value.trim(),
      helpline_number: $("siteHelpline").value.trim(),
      welcome_message: $("siteWelcome").value.trim() || "Hi, how can I help?",
      fallback_message: $("siteFallback").value.trim() || "I could not find the exact answer. Please contact our helpline.",
      active: $("siteActive").checked,
      allowed_origins: $("siteAllowedOrigins").value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s),
      primary_color: $("sitePrimaryColor").value,
      bot_name: $("siteBotName").value.trim() || "Support Bot",
      bot_avatar_url: $("siteBotAvatar").value.trim(),
      launcher_icon: $("siteLauncherIcon").value.trim() || "?",
    };
    
    if ($("siteAcceptDistance").value !== "") {
      payload.faq_accept_distance = Number($("siteAcceptDistance").value);
    }
    if ($("siteCandidateDistance").value !== "") {
      payload.llm_candidate_distance = Number($("siteCandidateDistance").value);
    }

    const existing = siteId && state.sites.some((site) => site.id === siteId);
    if (existing) {
      await api(`/api/sites/${siteId}`, { method: "PATCH", body: JSON.stringify(payload) });
      setStatus(`Updated site: ${siteId}`);
    } else {
      payload.id = siteId || undefined;
      await api("/api/sites", { method: "POST", body: JSON.stringify(payload) });
      setStatus(`Created site: ${siteId || "new"}`);
    }
    
    event.target.reset();
    $("siteId").readOnly = false;
    $("siteActive").checked = true;
    await refreshAll();
  } catch (error) {
    console.error(error);
    alert(`Failed to save site: ${error.message}`);
  }
});

$("groupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const groupId = $("groupId").value.trim();
  const payload = {
    id: groupId || undefined,
    name: $("groupName").value.trim(),
    description: $("groupDescription").value.trim(),
    site_ids: selectedCheckboxValues("groupSite"),
    active: true,
  };
  const existing = groupId && state.groups.some((group) => group.id === groupId);
  if (existing) {
    const { id, ...patch } = payload;
    await api(`/api/groups/${groupId}`, { method: "PATCH", body: JSON.stringify(patch) });
  } else {
    await api("/api/groups", { method: "POST", body: JSON.stringify(payload) });
  }
  event.target.reset();
  await refreshAll();
});

$("faqForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = document.querySelector("input[name='targetMode']:checked").value;
  const faqId = $("faqId").value.trim();
  const payload = {
    question: $("faqQuestion").value.trim(),
    answer: $("faqAnswer").value.trim(),
    aliases: $("faqAliases").value.split("\n").map((item) => item.trim()).filter(Boolean),
    site_ids: [],
    group_ids: [],
    active: true,
  };
  if (mode === "current") {
    payload.site_ids = state.currentSiteId ? [state.currentSiteId] : [];
  }
  if (mode === "multiple") {
    payload.site_ids = selectedCheckboxValues("faqSite");
  }
  if (mode === "group") {
    payload.group_ids = $("faqGroupSelect").value ? [$("faqGroupSelect").value] : [];
  }
  if (faqId) {
    // Optimistic Update
    const previousFaqs = [...state.faqs];
    const index = state.faqs.findIndex(f => f.id === faqId);
    if (index !== -1) {
      state.faqs[index] = { ...state.faqs[index], ...payload };
      renderFaqs();
    }
    
    try {
      const newFaq = await api(`/api/faqs/${faqId}`, { method: "PATCH", body: JSON.stringify(payload) });
      state.faqs[index] = newFaq; // Sync with real backend data (timestamps, etc)
      renderFaqs();
    } catch (e) {
      state.faqs = previousFaqs;
      renderFaqs();
      alert("Update failed: " + e.message);
      return;
    }
  } else {
    // Fast Create (Wait for ID, then inject without reloading the whole list)
    try {
      const newFaq = await api("/api/faqs", { method: "POST", body: JSON.stringify(payload) });
      state.faqs.unshift(newFaq); // Add to top of list
      renderFaqs();
    } catch (e) {
      alert("Create failed: " + e.message);
      return;
    }
  }
  clearFaqForm();
  refreshAnalytics(); // Refresh in background
});

function clearFaqForm() {
  $("faqId").value = "";
  $("faqQuestion").value = "";
  $("faqAliases").value = "";
  $("faqAnswer").value = "";
  document.querySelector("input[name='targetMode'][value='current']").checked = true;
  updateTargetMode();
}

$("clearFaqBtn").addEventListener("click", clearFaqForm);

$("importCsvBtn").addEventListener("click", () => {
  if (!state.currentSiteId) {
    alert("Please select a site first.");
    return;
  }
  $("csvFile").click();
});

$("csvFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file || !state.currentSiteId) return;

  const formData = new FormData();
  formData.append("file", file);

  try {
    setStatus("Uploading CSV...");
    $("importCsvBtn").disabled = true;
    const result = await api(`/api/sites/${state.currentSiteId}/faqs/upload`, {
      method: "POST",
      body: formData,
      headers: {}, // Body is FormData, so headers will be handled by api()
    });
    
    if (result.task_id) {
      // Start polling
      let isDone = false;
      while (!isDone) {
        setStatus(`Queued: Waiting to start indexing...`);
        await new Promise(r => setTimeout(r, 2000)); // Poll every 2 seconds
        
        const task = await api(`/api/tasks/${result.task_id}`);
        if (task.status === "processing") {
          setStatus(`Indexing: ${task.processed_items} / ${task.total_items} rows...`);
        } else if (task.status === "completed") {
          setStatus(`Completed: Indexed ${task.total_items} rows.`);
          alert("Import completed successfully!");
          isDone = true;
        } else if (task.status === "failed") {
          setStatus("Failed.");
          alert(`Import failed: ${task.error_message}`);
          isDone = true;
        }
      }
    } else {
      alert(result.message);
    }
    
    await refreshFaqs();
  } catch (error) {
    alert(`Import request failed: ${error.message}`);
  } finally {
    event.target.value = "";
    $("importCsvBtn").disabled = false;
    setStatus("Ready");
  }
});

$("leadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.currentSiteId) {
    alert("Please select a site first.");
    return;
  }
  const btn = $("startSessionBtn");
  btn.disabled = true;
  btn.textContent = "Starting...";
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
    }).then((r) => r.json());
    state.sessionId = session.id;
    addMessage("bot", `Session started! Ask me anything about ${currentSite()?.name || state.currentSiteId}.`);
    $("leadForm").classList.add("hidden");
    $("testForm").classList.remove("hidden");
    $("testQuestion").focus();
  } catch (err) {
    addMessage("bot", "Could not start session. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Start Session";
  }
});

$("testForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = $("testQuestion").value.trim();
  if (!question || !state.currentSiteId) return;

  addMessage("user", question);
  $("testQuestion").value = "";

  const sendBtn = $("testSendBtn");
  sendBtn.disabled = true;

  // Show "Thinking..." indicator immediately
  const thinkingNode = addTypingIndicator();

  let botNode = null;
  let botText = "";
  let metadata = {};

  try {
    const response = await fetch("/api/chat/message/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: state.currentSiteId,
        session_id: state.sessionId,
        question,
        name: $("testName").value,
        email: $("testEmail").value,
        phone: $("testPhone").value,
      }),
    });

    if (!response.ok || !response.body) throw new Error("Stream failed");

    const reader = response.body.getReader();
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
          const event = JSON.parse(line);
          if (event.type === "metadata") {
            metadata = event;
            state.sessionId = event.session_id || state.sessionId;
          } else if (event.type === "token") {
            // First token: swap thinking indicator → real bot bubble
            if (!botNode) {
              thinkingNode.remove();
              botNode = addMessage("bot", "");
            }
            botText += event.text || "";
            botNode.querySelector(".msg-text").textContent = botText;
            $("testMessages").scrollTop = $("testMessages").scrollHeight;
          }
        } catch {}
      }
    }

    // If we got tokens, append the response type badge
    if (botNode) {
      const responseType = (metadata.response_type || "faq_hit").replaceAll("_", " ");
      const badge = document.createElement("span");
      badge.className = "msg-badge";
      badge.textContent = responseType;
      badge.style.cssText = "display:block;font-size:0.72rem;margin-top:5px;opacity:0.5;text-transform:uppercase;letter-spacing:0.05em;";
      botNode.appendChild(badge);
    } else {
      // Stream connected but returned no tokens (e.g. helpline)
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
  const textSpan = document.createElement("span");
  textSpan.className = "msg-text";
  textSpan.textContent = text;
  node.appendChild(textSpan);
  $("testMessages").appendChild(node);
  $("testMessages").scrollTop = $("testMessages").scrollHeight;
  return node;
}

function addTypingIndicator() {
  const node = document.createElement("div");
  node.className = "message bot";
  node.innerHTML = `<span class="msg-text" style="opacity:0.6; font-style:italic;">Thinking</span>
    <span style="display:inline-flex;gap:3px;vertical-align:middle;margin-left:6px;">
      <span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:blink 1.2s 0s infinite;display:inline-block"></span>
      <span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:blink 1.2s 0.2s infinite;display:inline-block"></span>
      <span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:blink 1.2s 0.4s infinite;display:inline-block"></span>
    </span>`;
  $("testMessages").appendChild(node);
  $("testMessages").scrollTop = $("testMessages").scrollHeight;
  return node;
}


$("userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("userEmailInput").value.trim();
  const password = $("userPasswordInput").value.trim();
  const role = $("userRoleSelect").value;
  const site_ids = selectedCheckboxValues("userSite");

  if (!site_ids.length && role !== "super_admin") {
    alert("Please select at least one site for this user.");
    return;
  }

  try {
    const result = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({ email, password, role, site_ids }),
    });
    alert(result.message);
    event.target.reset();
    renderUserSites();
  } catch (error) {
    alert("Failed to create user: " + error.message);
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  // Initial check is handled by firebase.auth().onAuthStateChanged
  // or manually clicking 'Use API Key'
});
