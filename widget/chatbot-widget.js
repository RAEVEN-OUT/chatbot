(function () {
  const currentScript = document.currentScript;

  function boolAttr(value, fallback) {
    if (value == null) return fallback;
    return value === "true" || value === "1";
  }

  function createWidget(options) {
    const siteId = options.siteId;
    const apiBase = (options.apiBase || "").replace(/\/$/, "");
    const collectLead = options.collectLead !== false;
    let sessionId = "";
    let lead = { name: "", email: "", phone: "" };

    const host = document.createElement("div");
    host.id = "faq-chatbot-host";
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });

    root.innerHTML = `
      <style>
        :host { font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .launcher {
          position: fixed;
          right: 20px;
          bottom: 20px;
          width: 58px;
          height: 58px;
          border-radius: 50%;
          border: 0;
          background: #126c57;
          color: #fff;
          box-shadow: 0 14px 32px rgba(0,0,0,.18);
          cursor: pointer;
          font-size: 24px;
        }
        .window {
          position: fixed;
          right: 20px;
          bottom: 90px;
          width: min(380px, calc(100vw - 32px));
          height: min(560px, calc(100vh - 120px));
          background: #fff;
          border: 1px solid #d9dfdd;
          border-radius: 8px;
          box-shadow: 0 18px 44px rgba(0,0,0,.2);
          display: none;
          overflow: hidden;
        }
        .window.open { display: grid; grid-template-rows: auto 1fr auto; }
        .header { background: #126c57; color: #fff; padding: 14px 16px; }
        .header h2 { font-size: 15px; margin: 0; }
        .messages { padding: 14px; overflow: auto; background: #f6f7f9; display: flex; flex-direction: column; gap: 10px; }
        .msg { max-width: 82%; border-radius: 8px; padding: 10px 12px; line-height: 1.4; white-space: pre-wrap; }
        .bot { align-self: flex-start; background: #fff; border: 1px solid #d9dfdd; color: #17201d; }
        .user { align-self: flex-end; background: #1d4d8f; color: #fff; }
        form { display: grid; gap: 8px; padding: 12px; border-top: 1px solid #d9dfdd; }
        .lead { grid-template-columns: 1fr; }
        .chat { grid-template-columns: 1fr auto; }
        input { min-height: 38px; border: 1px solid #d9dfdd; border-radius: 6px; padding: 8px 10px; font: inherit; }
        button { min-height: 38px; border: 0; border-radius: 6px; background: #126c57; color: #fff; font: inherit; padding: 0 14px; cursor: pointer; }
        .hidden { display: none; }
      </style>
      <button class="launcher" type="button" aria-label="Open chat">?</button>
      <section class="window" aria-live="polite">
        <div class="header"><h2>Chat Support</h2></div>
        <div class="messages"></div>
        <form class="lead">
          <input name="name" placeholder="Name" autocomplete="name" />
          <input name="email" placeholder="Email" autocomplete="email" />
          <input name="phone" placeholder="Phone" autocomplete="tel" />
          <button type="submit">Start Chat</button>
        </form>
        <form class="chat hidden">
          <input name="question" placeholder="Type your question" autocomplete="off" />
          <button type="submit">Send</button>
        </form>
      </section>
    `;

    const launcher = root.querySelector(".launcher");
    const win = root.querySelector(".window");
    const messages = root.querySelector(".messages");
    const leadForm = root.querySelector(".lead");
    const chatForm = root.querySelector(".chat");
    const header = root.querySelector(".header h2");

    launcher.addEventListener("click", () => {
      win.classList.toggle("open");
    });

    function addMessage(type, text) {
      const node = document.createElement("div");
      node.className = `msg ${type}`;
      node.textContent = text;
      messages.appendChild(node);
      messages.scrollTop = messages.scrollHeight;
    }

    async function post(path, body) {
      const response = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error("Chat request failed");
      }
      return response.json();
    }

    async function loadConfig() {
      try {
        const response = await fetch(`${apiBase}/api/chat/sites/${encodeURIComponent(siteId)}/config`);
        if (!response.ok) return;
        const config = await response.json();
        header.textContent = config.name || "Chat Support";
        addMessage("bot", config.welcomeMessage || "Hi, how can I help?");
      } catch (error) {
        addMessage("bot", "Chat is not available right now.");
      }
    }

    async function startSession() {
      const session = await post("/api/chat/sessions", { site_id: siteId, ...lead });
      sessionId = session.id;
      leadForm.classList.add("hidden");
      chatForm.classList.remove("hidden");
      chatForm.elements.question.focus();
    }

    leadForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      lead = {
        name: leadForm.elements.name.value.trim(),
        email: leadForm.elements.email.value.trim(),
        phone: leadForm.elements.phone.value.trim(),
      };
      await startSession();
    });

    chatForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const question = chatForm.elements.question.value.trim();
      if (!question) return;
      addMessage("user", question);
      chatForm.elements.question.value = "";
      try {
        const response = await post("/api/chat/message", {
          site_id: siteId,
          session_id: sessionId,
          question,
          ...lead,
        });
        sessionId = response.session_id || sessionId;
        addMessage("bot", response.answer);
      } catch (error) {
        addMessage("bot", "I could not send that. Please try again.");
      }
    });

    if (!collectLead) {
      startSession().catch(() => addMessage("bot", "Chat is not available right now."));
    }
    loadConfig();
  }

  window.FaqChatbot = {
    init: createWidget,
  };

  if (currentScript?.dataset.siteId) {
    createWidget({
      siteId: currentScript.dataset.siteId,
      apiBase: currentScript.dataset.apiBase || "",
      collectLead: boolAttr(currentScript.dataset.collectLead, true),
    });
  }
})();
