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
      initAdminDashboard();
    } catch (error) {
      console.error(error);
      await auth.signOut();
      adminVerifiedUser = null;
      dashboardInitialized = false;
      localStorage.removeItem("admin_session");
      showLogin();
      $("loginError").textContent = error.message || "Authentication failed.";
    }
  });
})();

function initAdminDashboard() {
  if (!adminVerifiedUser || dashboardInitialized) return;
  dashboardInitialized = true;
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
    if (response.status === 401) {
      localStorage.removeItem("admin_session");
      throw new Error("Session expired. Please refresh and try again.");
    }
    if (!response.ok) throw new Error(await response.text() || `Request failed: ${response.status}`);
    if (response.status === 204) return null;
    return response.json();
  } finally {
    setGlobalLoading(false);
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
  $("statusText").textContent = text;
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
    if (!state.currentSiteId && state.sites.find((site) => !site.deleted_at)) {
      state.currentSiteId = state.sites.find((site) => !site.deleted_at).id;
    }
    renderReferenceControls();
    renderSites();
    renderGroups();
    renderUserSites();
    syncChoosers();
    setStatus(`${state.sites.length} sites, ${state.groups.length} groups`);
    refreshFaqs();
    refreshLogs();
    refreshAnalytics();
  } catch (error) {
    setStatus(`Refresh failed: ${error.message}`);
  }
}

function syncChoosers() {
  const site = currentSite();
  const value = siteDisplay(site);
  ["faqSiteChooser", "analyticsSiteChooser", "testerSiteChooser"].forEach((id) => {
    if ($(id)) $(id).value = value;
  });
  updateTesterSiteName();
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
  const query = $("siteSearch").value.trim().toLowerCase();
  const filter = $("siteFilter").value;
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
    ? sites.map((site) => `
        <div class="row ${site.deleted_at ? "is-muted" : ""}">
          <div>
            <p class="row-title">${esc(site.name)}</p>
            <p class="meta">${esc(site.id)} | ${esc(site.domain || "no domain")}</p>
            <p class="meta">${recentStamp(site)} ${site.deleted_at ? "| " + deletionText(site) : ""}</p>
          </div>
          <div class="meta">${esc(site.helpline_number || "no helpline")}</div>
          <div class="actions">
            <button class="ghost" onclick="editSite('${esc(site.id)}')">Select</button>
            <button class="secondary" onclick="openSitePortal('${esc(site.id)}')" ${site.deleted_at ? "disabled" : ""}>Open Portal</button>
          </div>
        </div>`).join("")
    : `<p class="meta">No sites found.</p>`;
}

function groupMatches(group) {
  const query = $("groupSearch").value.trim().toLowerCase();
  const filter = $("groupFilter").value;
  if (filter === "active" && group.active === false) return false;
  if (filter === "inactive" && group.active !== false) return false;
  if (!query) return true;
  const siteNames = group.site_ids.map((id) => state.sites.find((site) => site.id === id)?.name || id).join(" ");
  return [group.name, group.id, group.description, siteNames].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
}

function renderGroups() {
  $("groupSiteChecks").innerHTML = siteCheckboxes("groupSite", selectedCheckboxValues("groupSite"), $("groupSiteSearch").value);
  const groups = state.groups.filter(groupMatches).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  $("groupsList").innerHTML = groups.length
    ? groups.map((group) => {
        const siteNames = group.site_ids.map((siteId) => state.sites.find((site) => site.id === siteId)?.name || siteId).join(", ");
        return `
          <div class="row">
            <div>
              <p class="row-title">${esc(group.name)}</p>
              <p class="meta">${esc(group.id)} | ${recentStamp(group)}</p>
            </div>
            <div class="meta">${esc(siteNames || "No sites")}</div>
            <div class="actions">
              <button class="secondary" onclick="editGroup('${esc(group.id)}')">Edit</button>
              <button class="danger" onclick="deleteGroup('${esc(group.id)}')">Delete</button>
            </div>
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
  $("userSiteChecks").innerHTML = siteCheckboxes("userSite", selectedCheckboxValues("userSite"), $("userSiteSearch").value);
}

async function refreshFaqs() {
  const params = new URLSearchParams();
  if (state.currentGroupId) params.set("group_id", state.currentGroupId);
  else if (state.currentSiteId) params.set("site_id", state.currentSiteId);
  const faqs = await api(`/api/faqs${params.toString() ? "?" + params.toString() : ""}`);
  state.faqs = faqs;
  renderFaqs();
}

function renderFaqs() {
  const query = $("faqSearch").value.trim().toLowerCase();
  const faqs = state.faqs.filter((faq) => {
    if (!query) return true;
    return [faq.question, faq.answer, faq.id, ...(faq.aliases || [])].some((value) => String(value || "").toLowerCase().includes(query));
  });
  $("faqsList").innerHTML = faqs.length
    ? faqs.map((faq) => {
        const target = faq.site_id
          ? `Site: ${state.sites.find((site) => site.id === faq.site_id)?.name || faq.site_id}`
          : `Group: ${state.groups.find((group) => group.id === faq.group_id)?.name || faq.group_id}`;
        return `
          <article class="faq-item">
            <div>
              <h3>${esc(faq.question)}</h3>
              <p class="meta">${esc(target)} | ${recentStamp(faq)}</p>
            </div>
            <div class="faq-answer">${esc(faq.answer)}</div>
            <p class="meta">Aliases: ${esc((faq.aliases || []).join(", ") || "none")}</p>
            <div class="actions">
              <button class="secondary" onclick="editFaq('${esc(faq.id)}')">Edit</button>
              <button class="danger" onclick="deleteFaq('${esc(faq.id)}')">Delete</button>
            </div>
          </article>`;
      }).join("")
    : `<p class="meta">No FAQs found.</p>`;
}

async function refreshLogs() {
  const params = new URLSearchParams({ limit: "200" });
  if (state.currentSiteId) params.set("site_id", state.currentSiteId);
  if ($("fallbackOnly").checked) params.set("fallback_only", "true");
  if ($("logTypeFilter").value) params.set("response_type", $("logTypeFilter").value);
  if ($("logDateFilter").value) params.set("since", $("logDateFilter").value);
  state.logs = state.currentSiteId ? await api(`/api/logs?${params.toString()}`) : [];
  renderLogs();
}

function renderLogs() {
  const query = $("logSearch").value.trim().toLowerCase();
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
    $("topFaqsList").innerHTML = data.top_faqs.length
      ? data.top_faqs.map((faq) => `<div class="row"><p class="row-title">${esc(faq.question)}</p><div class="meta">${faq.count} uses</div><div></div></div>`).join("")
      : `<p class="meta">No FAQs used yet.</p>`;
  } catch (error) {
    console.error(error);
  }
}

function selectSite(siteId) {
  state.currentSiteId = siteId;
  state.currentGroupId = "";
  state.sessionId = "";
  syncChoosers();
  $("testMessages").innerHTML = "";
  $("leadForm").classList.remove("hidden");
  $("testForm").classList.add("hidden");
  refreshFaqs();
  refreshLogs();
  refreshAnalytics();
}

function selectGroup(groupId) {
  state.currentGroupId = groupId;
  state.currentSiteId = "";
  $("faqSiteChooser").value = "";
  $("faqGroupChooser").value = groupDisplay(state.groups.find((group) => group.id === groupId));
  refreshFaqs();
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
  $("groupId").value = group.id;
  $("groupName").value = group.name;
  $("groupDescription").value = group.description || "";
  $("groupSiteChecks").innerHTML = siteCheckboxes("groupSite", group.site_ids || [], $("groupSiteSearch").value);
};

window.deleteGroup = async function deleteGroup(groupId) {
  if (!confirm("Delete this group?")) return;
  const previous = [...state.groups];
  state.groups = state.groups.filter((group) => group.id !== groupId);
  renderGroups();
  try {
    await api(`/api/groups/${groupId}`, { method: "DELETE" });
  } catch (error) {
    state.groups = previous;
    renderGroups();
    alert(`Delete failed: ${error.message}`);
  }
};

function openCreateFaqModal() {
  $("faqModalTitle").textContent = "Add FAQ";
  clearFaqForm();
  const site = currentSite();
  $("faqTargetSite").value = siteDisplay(site);
  $("faqTargetGroup").value = "";
  $("faqModal").showModal();
}

window.editFaq = function editFaq(faqId) {
  const faq = state.faqs.find((item) => item.id === faqId);
  if (!faq) return;
  $("faqModalTitle").textContent = "Edit FAQ";
  $("faqId").value = faq.id;
  $("faqQuestion").value = faq.question;
  $("faqAliases").value = (faq.aliases || []).join("\n");
  $("faqAnswer").value = faq.answer;
  $("faqTargetSite").value = faq.site_id ? siteDisplay(state.sites.find((site) => site.id === faq.site_id)) : "";
  $("faqTargetGroup").value = faq.group_id ? groupDisplay(state.groups.find((group) => group.id === faq.group_id)) : "";
  $("faqModal").showModal();
};

window.deleteFaq = async function deleteFaq(faqId) {
  if (!confirm("Delete this FAQ?")) return;
  const previous = [...state.faqs];
  state.faqs = state.faqs.filter((faq) => faq.id !== faqId);
  renderFaqs();
  try {
    await api(`/api/faqs/${faqId}`, { method: "DELETE" });
    refreshAnalytics();
  } catch (error) {
    state.faqs = previous;
    renderFaqs();
    alert(`Delete failed: ${error.message}`);
  }
};

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

function faqPayload() {
  const siteId = idFromChooser($("faqTargetSite").value, state.sites);
  const groupId = idFromChooser($("faqTargetGroup").value, state.groups);
  const hasSite = Boolean(siteId);
  const hasGroup = Boolean(groupId);
  if (hasSite === hasGroup) throw new Error("Choose exactly one target site or one target group.");
  return {
    question: $("faqQuestion").value.trim(),
    answer: $("faqAnswer").value.trim(),
    aliases: $("faqAliases").value.split("\n").map((item) => item.trim()).filter(Boolean),
    site_id: hasSite ? siteId : "",
    group_id: hasGroup ? groupId : "",
    active: true,
  };
}

$("faqTargetSite").addEventListener("input", () => {
  if ($("faqTargetSite").value.trim()) $("faqTargetGroup").value = "";
});
$("faqTargetGroup").addEventListener("input", () => {
  if ($("faqTargetGroup").value.trim()) $("faqTargetSite").value = "";
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
  $("loginError").textContent = "Checking access...";
  try {
    await auth.signOut();
    localStorage.removeItem("admin_session");
    await auth.signInWithEmailAndPassword($("loginEmail").value, $("loginPassword").value);
  } catch (error) {
    $("loginError").textContent = error.message;
    auth.signOut();
  }
});

$("logoutBtn").addEventListener("click", () => {
  adminVerifiedUser = null;
  dashboardInitialized = false;
  auth.signOut();
  localStorage.removeItem("admin_session");
  showLogin();
});

$("refreshBtn").addEventListener("click", refreshAll);
$("createSiteBtn").addEventListener("click", openCreateSiteModal);
$("closeSiteModalBtn").addEventListener("click", () => $("siteModal").close());
$("createFaqBtn").addEventListener("click", openCreateFaqModal);
$("closeFaqModalBtn").addEventListener("click", () => $("faqModal").close());
$("clearFaqBtn").addEventListener("click", clearFaqForm);

["siteSearch", "siteFilter"].forEach((id) => $(id).addEventListener("input", renderSites));
["groupSearch", "groupFilter"].forEach((id) => $(id).addEventListener("input", renderGroups));
$("groupSiteSearch").addEventListener("input", renderGroups);
$("userSiteSearch").addEventListener("input", renderUserSites);
$("faqSearch").addEventListener("input", renderFaqs);
$("logSearch").addEventListener("input", renderLogs);
["fallbackOnly", "logTypeFilter", "logDateFilter"].forEach((id) => $(id).addEventListener("change", refreshLogs));

$("faqSiteChooser").addEventListener("change", () => {
  const siteId = idFromChooser($("faqSiteChooser").value, state.sites);
  if (siteId) {
    $("faqGroupChooser").value = "";
    selectSite(siteId);
  }
});
$("faqGroupChooser").addEventListener("change", () => {
  const groupId = idFromChooser($("faqGroupChooser").value, state.groups);
  if (groupId) {
    $("faqSiteChooser").value = "";
    selectGroup(groupId);
  }
});
$("analyticsSiteChooser").addEventListener("change", () => {
  const siteId = idFromChooser($("analyticsSiteChooser").value, state.sites);
  if (siteId) selectSite(siteId);
});
$("testerSiteChooser").addEventListener("change", () => {
  const siteId = idFromChooser($("testerSiteChooser").value, state.sites);
  if (siteId) selectSite(siteId);
});

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));

$("siteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const siteId = $("siteId").value.trim();
  const payload = sitePayload();
  const previous = [...state.sites];
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
    $("siteModal").close();
  } catch (error) {
    state.sites = previous;
    renderSites();
    alert(`Save failed: ${error.message}`);
  }
});

$("repairSiteBtn").addEventListener("click", async () => {
  const siteId = $("siteId").value;
  if (!siteId || !confirm("Repair vectors for this site?")) return;
  const result = await api(`/api/sites/${siteId}/reindex`, { method: "POST" });
  alert(`Reindexed ${result.total_items ?? 0} FAQs.`);
});

$("deleteSiteBtn").addEventListener("click", async () => {
  const siteId = $("siteId").value;
  if (!siteId || !confirm("Delete this site? It will be hidden from users and purged after 7 days.")) return;
  const previous = [...state.sites];
  const index = state.sites.findIndex((site) => site.id === siteId);
  if (index !== -1) {
    const now = new Date().toISOString();
    state.sites[index] = { ...state.sites[index], active: false, deleted_at: now, updated_at: now };
    renderSites();
  }
  try {
    const deleted = await api(`/api/sites/${siteId}`, { method: "DELETE" });
    state.sites[index] = deleted;
    $("siteModal").close();
    renderSites();
  } catch (error) {
    state.sites = previous;
    renderSites();
    alert(`Delete failed: ${error.message}`);
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
  const previous = [...state.groups];
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
    $("groupForm").reset();
    renderReferenceControls();
    renderGroups();
  } catch (error) {
    state.groups = previous;
    renderGroups();
    alert(`Save failed: ${error.message}`);
  }
});

$("faqForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  let payload;
  try {
    payload = faqPayload();
  } catch (error) {
    alert(error.message);
    return;
  }
  const faqId = $("faqId").value.trim();
  const previous = [...state.faqs];
  try {
    if (faqId) {
      const index = state.faqs.findIndex((faq) => faq.id === faqId);
      if (index !== -1) {
        state.faqs[index] = { ...state.faqs[index], ...payload, updated_at: new Date().toISOString() };
        renderFaqs();
      }
      const updated = await api(`/api/faqs/${faqId}`, { method: "PATCH", body: JSON.stringify(payload) });
      if (index !== -1) state.faqs[index] = updated;
    } else {
      const temp = { ...payload, id: `saving-${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.faqs.unshift(temp);
      renderFaqs();
      const created = await api("/api/faqs", { method: "POST", body: JSON.stringify(payload) });
      state.faqs = state.faqs.map((faq) => (faq.id === temp.id ? created : faq));
    }
    renderFaqs();
    $("faqModal").close();
    refreshAnalytics();
  } catch (error) {
    state.faqs = previous;
    renderFaqs();
    alert(`Save failed: ${error.message}`);
  }
});

$("userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const site_ids = selectedCheckboxValues("userSite");
  if (!site_ids.length) {
    alert("Select at least one site.");
    return;
  }
  try {
    const result = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        email: $("userEmailInput").value.trim(),
        password: $("userPasswordInput").value.trim(),
        site_ids,
      }),
    });
    alert(result.message);
    event.target.reset();
    renderUserSites();
  } catch (error) {
    alert(`Failed to create user: ${error.message}`);
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
