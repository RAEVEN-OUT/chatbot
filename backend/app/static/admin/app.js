const state = {
  sites: [],
  groups: [],
  faqs: [],
  logs: [],
  currentSiteId: "",
  sessionId: "",
};

const $ = (id) => document.getElementById(id);

function adminHeaders(extra = {}) {
  const key = localStorage.getItem("adminApiKey") || "";
  return {
    "Content-Type": "application/json",
    ...(key ? { "x-admin-api-key": key } : {}),
    ...extra,
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: adminHeaders(options.headers || {}),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
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
  state.sites = await api("/api/sites");
  state.groups = await api("/api/groups");
  if (!state.currentSiteId && state.sites.length) {
    state.currentSiteId = state.sites[0].id;
  }
  renderSiteSelect();
  renderSites();
  renderGroups();
  renderTargetControls();
  await refreshFaqs();
  await refreshLogs();
  setStatus(`${state.sites.length} sites, ${state.groups.length} groups`);
}

async function refreshFaqs() {
  const query = state.currentSiteId ? `?site_id=${encodeURIComponent(state.currentSiteId)}` : "";
  state.faqs = state.currentSiteId ? await api(`/api/faqs${query}`) : [];
  renderFaqs();
}

async function refreshLogs() {
  const params = new URLSearchParams();
  if (state.currentSiteId) params.set("site_id", state.currentSiteId);
  if ($("fallbackOnly").checked) params.set("fallback_only", "true");
  state.logs = state.currentSiteId ? await api(`/api/logs?${params.toString()}`) : [];
  renderLogs();
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
          </div>
          <div class="meta">${escapeHtml(site.helpline_number)}</div>
          <div class="actions">
            <button class="ghost" onclick="selectSite('${site.id}')">Select</button>
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

function renderTargetControls(selectedSites = [], selectedGroup = "") {
  $("faqSiteChecks").innerHTML = siteCheckboxes("faqSite", selectedSites);
  $("faqGroupSelect").innerHTML = state.groups
    .map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
    .join("");
  if (selectedGroup) {
    $("faqGroupSelect").value = selectedGroup;
  }
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
  $("siteSelect").value = siteId;
  await refreshFaqs();
  await refreshLogs();
};

window.editSite = function editSite(siteId) {
  const site = state.sites.find((item) => item.id === siteId);
  if (!site) return;
  $("siteId").value = site.id;
  $("siteName").value = site.name;
  $("siteDomain").value = site.domain || "";
  $("siteHelpline").value = site.helpline_number;
  $("siteWelcome").value = site.welcome_message || "";
  $("siteFallback").value = site.fallback_message || "";
  $("siteAcceptDistance").value = site.faq_accept_distance;
  $("siteCandidateDistance").value = site.llm_candidate_distance;
  $("siteActive").checked = site.active;
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
  await api(`/api/faqs/${faqId}`, { method: "DELETE" });
  await refreshFaqs();
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
}

function selectedCheckboxValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

$("saveKeyBtn").addEventListener("click", () => {
  localStorage.setItem("adminApiKey", $("adminKey").value);
  setStatus("Admin key saved");
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
  const siteId = $("siteId").value.trim();
  const payload = {
    id: siteId || undefined,
    name: $("siteName").value.trim(),
    domain: $("siteDomain").value.trim(),
    helpline_number: $("siteHelpline").value.trim(),
    welcome_message: $("siteWelcome").value.trim() || "Hi, how can I help?",
    fallback_message: $("siteFallback").value.trim() || "I could not find the exact answer. Please contact our helpline.",
    active: $("siteActive").checked,
  };
  if ($("siteAcceptDistance").value) {
    payload.faq_accept_distance = Number($("siteAcceptDistance").value);
  }
  if ($("siteCandidateDistance").value) {
    payload.llm_candidate_distance = Number($("siteCandidateDistance").value);
  }
  const existing = siteId && state.sites.some((site) => site.id === siteId);
  if (existing) {
    const { id, ...patch } = payload;
    await api(`/api/sites/${siteId}`, { method: "PATCH", body: JSON.stringify(patch) });
  } else {
    await api("/api/sites", { method: "POST", body: JSON.stringify(payload) });
  }
  event.target.reset();
  $("siteActive").checked = true;
  await refreshAll();
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
    await api(`/api/faqs/${faqId}`, { method: "PATCH", body: JSON.stringify(payload) });
  } else {
    await api("/api/faqs", { method: "POST", body: JSON.stringify(payload) });
  }
  clearFaqForm();
  await refreshFaqs();
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

$("leadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.currentSiteId) return;
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
  addMessage("bot", `Session started for ${currentSite()?.name || state.currentSiteId}`);
});

$("testForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = $("testQuestion").value.trim();
  if (!question || !state.currentSiteId) return;
  addMessage("user", question);
  $("testQuestion").value = "";
  const response = await fetch("/api/chat/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site_id: state.currentSiteId,
      session_id: state.sessionId,
      question,
    }),
  }).then((item) => item.json());
  state.sessionId = response.session_id || state.sessionId;
  addMessage("bot", `${response.answer} (${response.response_type})`);
  await refreshLogs();
});

function addMessage(type, text) {
  const node = document.createElement("div");
  node.className = `message ${type}`;
  node.textContent = text;
  $("testMessages").prepend(node);
}

window.addEventListener("DOMContentLoaded", async () => {
  $("adminKey").value = localStorage.getItem("adminApiKey") || "";
  try {
    await refreshAll();
  } catch (error) {
    setStatus(error.message);
  }
});
