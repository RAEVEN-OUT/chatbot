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
    const configCacheKey = `faq-chatbot-config:${siteId}`;

    const host = document.createElement("div");
    host.id = "faq-chatbot-host";
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });

    root.innerHTML = `
      <style>
        :host { 
          font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          --primary: #126c57;
          --text-on-primary: #ffffff;
        }
        .launcher {
          position: fixed;
          right: 20px;
          bottom: 20px;
          width: 58px;
          height: 58px;
          border-radius: 50%;
          border: 0;
          background: var(--primary);
          color: var(--text-on-primary);
          box-shadow: 0 14px 32px rgba(0,0,0,.18);
          cursor: pointer;
          font-size: 24px;
          transition: transform 0.2s ease;
        }
        .launcher:hover { transform: scale(1.05); }
        .window {
          position: fixed;
          right: 20px;
          bottom: 90px;
          width: min(380px, calc(100vw - 32px));
          height: min(560px, calc(100vh - 120px));
          background: #fff;
          border: 1px solid #d9dfdd;
          border-radius: 12px;
          box-shadow: 0 18px 44px rgba(0,0,0,.2);
          display: none;
          overflow: hidden;
          z-index: 9999;
        }
        .window.open { display: grid; grid-template-rows: auto 1fr auto; }
        .header { background: var(--primary); color: var(--text-on-primary); padding: 16px; display: flex; align-items: center; gap: 10px; }
        .header-avatar { width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.2); object-fit: cover; }
        .header h2 { font-size: 15px; margin: 0; }
        .messages { padding: 14px; overflow: auto; background: #f6f7f9; display: flex; flex-direction: column; gap: 10px; }
        .msg { max-width: 82%; border-radius: 12px; padding: 10px 14px; line-height: 1.4; white-space: pre-wrap; font-size: 0.95rem; }
        .bot { align-self: flex-start; background: #fff; border: 1px solid #d9dfdd; color: #17201d; border-bottom-left-radius: 2px; }
        .user { align-self: flex-end; background: var(--primary); color: var(--text-on-primary); border-bottom-right-radius: 2px; }
        .typing-dots { display: inline-flex; align-items: center; gap: 4px; padding: 2px 0; }
        .typing-dots span { width: 7px; height: 7px; border-radius: 50%; background: #9ca3af; display: inline-block; animation: dot-bounce 1.2s infinite ease-in-out; }
        .typing-dots span:nth-child(1) { animation-delay: 0s; }
        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dot-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-5px); opacity: 1; } }
        form { display: grid; gap: 8px; padding: 12px; border-top: 1px solid #d9dfdd; }
        .lead { grid-template-columns: 1fr; }
        .chat { grid-template-columns: 1fr auto; }
        input { min-height: 40px; border: 1px solid #d9dfdd; border-radius: 8px; padding: 8px 12px; font: inherit; }
        button { min-height: 40px; border: 0; border-radius: 8px; background: var(--primary); color: var(--text-on-primary); font: inherit; padding: 0 16px; cursor: pointer; font-weight: 500; }
        .hidden { display: none; }
      </style>
      <button class="launcher" type="button" aria-label="Open chat">?</button>
      <section class="window" aria-live="polite">
        <div class="header">
          <img class="header-avatar hidden" src="" alt="" />
          <h2 class="header-name">Chat Support</h2>
        </div>
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

    launcher.addEventListener("click", () => {
      win.classList.toggle("open");
    });

    function addMessage(type, text) {
      const node = document.createElement("div");
      node.className = `msg ${type}`;
      node.textContent = text;
      messages.appendChild(node);
      messages.scrollTop = messages.scrollHeight;
      return node;
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

    async function postStream(path, body, onToken) {
      const response = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok || !response.body) {
        throw new Error("Chat stream failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let metadata = {};

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "metadata") {
            metadata = event;
          }
          if (event.type === "token") {
            onToken(event.text || "");
          }
        }
      }

      return metadata;
    }

    async function sendChatMessage(body, onToken) {
      try {
        return await postStream("/api/chat/message/stream", body, onToken);
      } catch (error) {
        const response = await post("/api/chat/message", body);
        onToken(response.answer || "");
        return response;
      }
    }

    function applyConfig(config) {
      if (config.primaryColor) {
        host.style.setProperty("--primary", config.primaryColor);
        const color = config.primaryColor.replace("#", "");
        const r = parseInt(color.substr(0, 2), 16);
        const g = parseInt(color.substr(2, 2), 16);
        const b = parseInt(color.substr(4, 2), 16);
        const yiq = (r * 299 + g * 587 + b * 114) / 1000;
        host.style.setProperty("--text-on-primary", yiq >= 128 ? "#000000" : "#ffffff");
      }

      if (config.botName) {
        root.querySelector(".header-name").textContent = config.botName;
      }

      if (config.botAvatar) {
        const avatar = root.querySelector(".header-avatar");
        avatar.src = config.botAvatar;
        avatar.classList.remove("hidden");
      }

      if (config.launcherIcon) {
        launcher.textContent = config.launcherIcon;
      }
    }

    async function loadConfig() {
      try {
        const cached = localStorage.getItem(configCacheKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.savedAt < 10 * 60 * 1000) {
              applyConfig(parsed.config);
              addMessage("bot", parsed.config.welcomeMessage || "Hi, how can I help?");
            }
          } catch {
            localStorage.removeItem(configCacheKey);
          }
        }

        const response = await fetch(`${apiBase}/api/chat/sites/${encodeURIComponent(siteId)}/config`);
        if (!response.ok) return;
        const config = await response.json();
        localStorage.setItem(configCacheKey, JSON.stringify({ savedAt: Date.now(), config }));
        applyConfig(config);

        if (!messages.textContent.trim()) {
          addMessage("bot", config.welcomeMessage || "Hi, how can I help?");
        }
      } catch (error) {
        if (!messages.textContent.trim()) {
          addMessage("bot", "Chat is not available right now.");
        }
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
      const button = chatForm.querySelector("button");

      // Show animated typing dots while waiting for the first token
      const botMessage = addMessage("bot", "");
      const dots = document.createElement("span");
      dots.className = "typing-dots";
      dots.innerHTML = "<span></span><span></span><span></span>";
      botMessage.appendChild(dots);

      let botText = "";
      let firstToken = true;
      button.disabled = true;
      try {
        const response = await sendChatMessage({
          site_id: siteId,
          session_id: sessionId,
          question,
          ...lead,
        }, (chunk) => {
          if (firstToken) {
            // Remove the dots on first real character
            botMessage.innerHTML = "";
            firstToken = false;
          }
          botText += chunk;
          botMessage.textContent = botText;
          messages.scrollTop = messages.scrollHeight;
        });
        // If no tokens came (non-streaming fallback), clear dots
        if (firstToken) {
          botMessage.innerHTML = "";
          botMessage.textContent = botText;
        }
        sessionId = response.session_id || sessionId;
      } catch (error) {
        botMessage.innerHTML = "";
        botMessage.textContent = "I could not send that. Please try again.";
      } finally {
        button.disabled = false;
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
