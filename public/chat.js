/**
 * LLM Chat Frontend + Browser-side Code Runner
 * Python: Pyodide (WASM)  |  C/C++: JSCPP (in-browser interpreter)
 * No remote execution API required.
 *
 * C++ 编译器运行时已整合到 public/vendor/jscpp-compat.js
 * 通过 window.JSCPPCompat.CompilerRuntime 使用吗 */

const WELCOME_MESSAGE =
  "你好！我是由 Cloudflare Workers AI 驱动的助手。有什么我可以帮你的吗？";

const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
  '<path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />' +
  "</svg>";

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
  '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />' +
  "</svg>";

const REMOVE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
  '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />' +
  "</svg>";

const PREVIEW_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
  '<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />' +
  '<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />' +
  "</svg>";

const LANG_LABEL = {
  python: "Python",
  py: "Python",
  python3: "Python",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  cxx: "C++",
  cc: "C++",
};

const RUNNABLE = {
  python: true,
  py: true,
  python3: true,
  c: true,
  cpp: true,
  "c++": true,
  cxx: true,
  cc: true,
};

let chatHistory = [{ role: "assistant", content: WELCOME_MESSAGE }];
let isProcessing = false;
let pendingAttachments = [];

let runnerLangKey = "python";
let runnerSource = "";
let runnerCM = null; // CodeMirror instance

/* Lazy-loaded engines */
let pyodideInstance = null;
let pyodideLoading = null;

// DOM elements (initialized in initDOM)
let chatMessages, userInput, sendButton, clearBtn, attachBtn, fileInput, attachmentsPreview;

// 全局错误上报：任何未捕获脚本错误都打印到控制台并标记到标题，避免静默失败
window.addEventListener("error", function (e) {
  console.error("[chat.js] 全局错误:", e.message, "@", e.filename + ":" + e.lineno);
  try {
    var out = document.getElementById("runner-output");
    if (out && document.getElementById("runner-overlay")?.classList.contains("open")) {
      out.textContent += "\n[脚本错误] " + e.message + " (" + e.filename + ":" + e.lineno + ")";
      out.className = "error";
    }
  } catch (ignored) {}
});
window.addEventListener("unhandledrejection", function (e) {
  console.error("[chat.js] 未处理的 Promise 拒绝:", e.reason);
});

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  try {
  // Cache DOM elements
  chatMessages = document.getElementById("chat-messages");
  userInput = document.getElementById("user-input");
  sendButton = document.getElementById("send-button");
  clearBtn = document.getElementById("clear-btn");
  attachBtn = document.getElementById("attach-btn");
  fileInput = document.getElementById("file-input");
  attachmentsPreview = document.getElementById("attachments-preview");
  previewOverlay = document.getElementById("preview-overlay");
  previewBody = document.getElementById("preview-body");
  previewTitle = document.getElementById("preview-title");
  previewClose = document.getElementById("preview-close");
  previewCopy = document.getElementById("preview-copy");

  renderWelcome();
  initRunnerModal();
  initFileUpload();
  initPreviewModal();
  initChatEvents();

  userInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 160) + "px";
    updateSendButton();
  });

updateSendButton();
  console.log("[chat.js] 初始化完成");
  } catch (initErr) {
    console.error("[chat.js] 初始化失败", initErr);
    // 初始化失败时给出可见提示，避免整个页面静默失败
    try {
      alert("页面初始化失败 " + (initErr && initErr.message ? initErr.message : initErr) +
        "\n请按 Ctrl+F5 强制刷新后重试");
    } catch (ignored) {}
  }
});

function updateSendButton() {
  const hasText = userInput.value.trim().length > 0;
  const hasAttachments = pendingAttachments.length > 0;
  sendButton.disabled = !(hasText || hasAttachments) || isProcessing;
}

function initFileUpload() {
  // Attach button click
  attachBtn.addEventListener("click", () => fileInput.click());

  // File input change
  fileInput.addEventListener("change", (e) => {
    handleFiles(Array.from(e.target.files));
    fileInput.value = "";
  });

  // Drag and drop on the whole input area
  const inputArea = document.querySelector(".input-area");
  inputArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    inputArea.classList.add("drop-zone", "active");
  });
  inputArea.addEventListener("dragleave", (e) => {
    if (!inputArea.contains(e.relatedTarget)) {
      inputArea.classList.remove("drop-zone", "active");
    }
  });
  inputArea.addEventListener("drop", (e) => {
    e.preventDefault();
    inputArea.classList.remove("drop-zone", "active");
    if (e.dataTransfer.files.length) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function getFileIcon(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const icons = {
    pdf: "PDF",
    txt: "TXT",
    md: "MD",
    csv: "CSV",
    json: "JSON",
    js: "JS",
    ts: "TS",
    py: "PY",
    cpp: "CPP",
    c: "C",
    h: "H",
    java: "JAVA",
    go: "GO",
    rs: "RS",
    html: "HTML",
    css: "CSS",
    xml: "XML",
    yaml: "YAML",
    yml: "YML",
  };
  return icons[ext] || ext.toUpperCase().slice(0, 3);
}

async function handleFiles(files) {
  const maxSize = 10 * 1024 * 1024; // 10MB
  const allowedTypes = [
    "text/",
    "application/json",
    "application/pdf",
    "image/",
  ];

  for (const file of files) {
    if (file.size > maxSize) {
      alert(`文件 "${file.name}" 超过 10MB 限制`);
      continue;
    }

    const isAllowed = allowedTypes.some((t) => file.type.startsWith(t));
    if (!isAllowed && !isTextFile(file.name)) {
      alert(`文件 "${file.name}" 类型不支持`);
      continue;
    }

    const attachment = await processFile(file);
    if (attachment) {
      pendingAttachments.push(attachment);
    }
  }
  renderAttachmentsPreview();
  updateSendButton();
}

function isTextFile(fileName) {
  const textExts = [
    "txt",
    "md",
    "csv",
    "json",
    "js",
    "ts",
    "py",
    "cpp",
    "c",
    "h",
    "hpp",
    "java",
    "go",
    "rs",
    "html",
    "css",
    "xml",
    "yaml",
    "yml",
    "sh",
    "sql",
    "ini",
    "toml",
    "vue",
    "jsx",
    "tsx",
  ];
  const ext = fileName.split(".").pop().toLowerCase();
  return textExts.includes(ext);
}

async function processFile(file) {
  const isImage = file.type.startsWith("image/");
  const isPDF = file.type === "application/pdf" || file.name.endsWith(".pdf");

  if (isImage) {
    return processImageFile(file);
  } else if (isPDF) {
    return processPDFFile(file);
  } else {
    return processTextFile(file);
  }
}

function processImageFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(",")[1];
      resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        data: base64,
        isImage: true,
      });
    };
    reader.readAsDataURL(file);
  });
}

function processTextFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve({
        name: file.name,
        type: file.type || "text/plain",
        size: file.size,
        data: e.target.result,
        isImage: false,
      });
    };
    reader.readAsText(file);
  });
}

async function processPDFFile(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = (await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs")).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(" ");
      fullText += pageText + "\n\n";
    }
    return {
      name: file.name,
      type: "application/pdf",
      size: file.size,
      data: fullText.trim() || "[PDF 内容为空或无法提取文本]",
      isImage: false,
    };
  } catch (e) {
    console.error("PDF 处理失败:", e);
    return {
      name: file.name,
      type: "application/pdf",
      size: file.size,
      data: "[PDF 处理失败，无法提取文本]",
      isImage: false,
    };
  }
}

function isCodeFile(fileName) {
  const codeExts = [
    "js", "ts", "jsx", "tsx", "py", "cpp", "c", "h", "hpp", "java", "go", "rs",
    "html", "css", "scss", "less", "json", "xml", "yaml", "yml", "md", "sql",
    "sh", "bash", "zsh", "fish", "php", "rb", "swift", "kt", "scala", "clj",
    "vue", "svelte", "dart", "lua", "r", "pl", "pm", "tcl", "vim", "ini",
    "toml", "cfg", "conf", "config", "properties", "gradle", "maven", "cmake",
    "make", "dockerfile", "gitignore", "gitattributes", "editorconfig"
  ];
  const ext = fileName.split(".").pop().toLowerCase();
  return codeExts.includes(ext);
}

function getLanguageFromFileName(fileName) {
  const ext = fileName.split(".").pop().toLowerCase();
  const langMap = {
    js: "javascript", ts: "typescript", jsx: "javascript", tsx: "typescript",
    py: "python", cpp: "cpp", c: "c", h: "cpp", hpp: "cpp",
    java: "java", go: "go", rs: "rust", html: "xml", css: "css",
    scss: "scss", less: "less", json: "json", xml: "xml",
    yaml: "yaml", yml: "yaml", md: "markdown", sql: "sql",
    sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
    php: "php", rb: "ruby", swift: "swift", kt: "kotlin",
    scala: "scala", clj: "clojure", vue: "xml", svelte: "html",
    dart: "dart", lua: "lua", r: "r", pl: "perl", pm: "perl",
    tcl: "tcl", vim: "vim", ini: "ini", toml: "toml",
    cfg: "ini", conf: "ini", config: "ini", properties: "properties",
    gradle: "groovy", maven: "xml", cmake: "cmake", make: "makefile",
    dockerfile: "dockerfile", gitignore: "gitignore"
  };
  return langMap[ext] || "plaintext";
}

function renderAttachmentsPreview() {
  if (pendingAttachments.length === 0) {
    attachmentsPreview.style.display = "none";
    attachmentsPreview.innerHTML = "";
    return;
  }
  attachmentsPreview.style.display = "flex";
  attachmentsPreview.innerHTML = pendingAttachments
    .map(
      (att, idx) => `
    <div class="attachment-item" data-index="${idx}">
      ${att.isImage ? `<img src="data:${att.type};base64,${att.data}" alt="${escapeHtml(att.name)}" />` : `<span class="file-icon">${getFileIcon({ name: att.name })}</span>`}
      <span class="file-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
      <span class="file-size">${formatFileSize(att.size)}</span>
      ${!att.isImage ? `<button class="preview-btn" title="预览">${PREVIEW_ICON}</button>` : ""}
      <button class="remove-btn" title="移除">${REMOVE_ICON}</button>
    </div>
  `
    )
    .join("");

  // Add remove handlers
  attachmentsPreview.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(e.currentTarget.parentElement.dataset.index);
      pendingAttachments.splice(idx, 1);
      renderAttachmentsPreview();
      updateSendButton();
    });
  });

  // Add preview handlers
  attachmentsPreview.querySelectorAll(".preview-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(e.currentTarget.parentElement.dataset.index);
      const att = pendingAttachments[idx];
      if (att) openPreview(att);
    });
  });
}

// Preview modal elements（在 initChat 中赋值）
let previewOverlay = null;
let previewBody = null;
let previewTitle = null;
let previewClose = null;
let previewCopy = null;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function openPreview(att) {
  previewTitle.textContent = att.name;
  previewBody.innerHTML = "";
  previewBody.className = "preview-body";

  if (att.isImage) {
    // Image preview
    const img = document.createElement("img");
    img.className = "preview-image";
    img.src = `data:${att.type};base64,${att.data}`;
    img.alt = att.name;
    previewBody.appendChild(img);
    previewCopy.style.display = "none";
  } else if (isCodeFile(att.name)) {
    // Code preview with syntax highlighting
    const lang = getLanguageFromFileName(att.name);
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = `language-${lang}`;
    code.textContent = att.data;
    pre.appendChild(code);
    previewBody.className = "preview-body preview-code";
    previewBody.appendChild(pre);
    // Apply syntax highlighting
    if (typeof hljs !== "undefined") {
      hljs.highlightElement(code);
    }
    previewCopy.style.display = "inline-flex";
    previewCopy.onclick = () => copyText(att.data, previewCopy);
  } else {
    // Plain text preview
    const pre = document.createElement("pre");
    pre.className = "preview-text";
    pre.textContent = att.data;
    previewBody.className = "preview-body preview-text";
    previewBody.appendChild(pre);
    previewCopy.style.display = "inline-flex";
    previewCopy.onclick = () => copyText(att.data, previewCopy);
  }

  previewOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closePreview() {
  previewOverlay.classList.remove("open");
  document.body.style.overflow = "";
  previewBody.innerHTML = "";
  previewTitle.textContent = "预览";
}

function initPreviewModal() {
  if (!previewClose) return;
  previewClose.addEventListener("click", closePreview);
  previewOverlay.addEventListener("click", (e) => {
    if (e.target === previewOverlay) closePreview();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && previewOverlay?.classList.contains("open")) closePreview();
  });
}

function initChatEvents() {
  userInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendButton.addEventListener("click", sendMessage);

  clearBtn.addEventListener("click", function () {
    if (isProcessing) return;
    chatHistory = [{ role: "assistant", content: WELCOME_MESSAGE }];
    pendingAttachments = [];
    renderAttachmentsPreview();
    chatMessages.innerHTML = "";
    renderWelcome();
    userInput.focus();
  });
}

function renderWelcome() {
  addMessageToChat("assistant", WELCOME_MESSAGE, [], false);
}

function thinkingHTML() {
  return (
    '<span class="thinking-label">AI思考中</span>' +
    '<span class="typing-dots"><span></span><span></span><span></span></span>'
  );
}

async function sendMessage() {
  const message = userInput.value.trim();
  if (message === "" && pendingAttachments.length === 0) return;
  if (isProcessing) return;

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;
  attachBtn.disabled = true;

  // Prepare attachments for this message
  const currentAttachments = [...pendingAttachments];
  pendingAttachments = [];
  renderAttachmentsPreview();

  // Add user message with attachments (display fallback when no text typed)
  addMessageToChat("user", message || "📎 附件", currentAttachments);
  chatHistory.push({ role: "user", content: message, attachments: currentAttachments });

  userInput.value = "";
  userInput.style.height = "auto";

  const assistantEl = createMessageElement("assistant", "");
  const bubble = assistantEl.querySelector(".bubble");
  bubble.classList.add("is-thinking");
  bubble.innerHTML = thinkingHTML();
  chatMessages.appendChild(assistantEl);
  scrollToBottom();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }),
    });

    if (!response.ok) throw new Error("Failed to get response");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let responseText = "";
    let firstChunk = true;
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by blank lines; process complete lines
      const parts = buffer.split("\n");
      // Keep the last incomplete line in buffer
      buffer = parts.pop() || "";

      for (let i = 0; i < parts.length; i++) {
        let line = parts[i].trim();
        if (!line) continue;
        // Handle SSE "data: ..." prefix
        if (line.startsWith("data:")) {
          line = line.slice(5).trim();
        }
        if (!line || line === "[DONE]") continue;
        try {
          const jsonData = JSON.parse(line);
          if (jsonData.response) {
            if (firstChunk) {
              bubble.classList.remove("is-thinking");
              firstChunk = false;
            }
            responseText += jsonData.response;
            bubble.innerHTML = formatContent(responseText);
            attachCodeToolbar(bubble);
            scrollToBottom();
          }
        } catch (e) {}
      }
    }
    // Process any remaining buffer
    if (buffer.trim()) {
      let line = buffer.trim();
      if (line.startsWith("data:")) line = line.slice(5).trim();
      if (line && line !== "[DONE]") {
        try {
          const jsonData = JSON.parse(line);
          if (jsonData.response) {
            if (firstChunk) {
              bubble.classList.remove("is-thinking");
              firstChunk = false;
            }
            responseText += jsonData.response;
            bubble.innerHTML = formatContent(responseText);
            attachCodeToolbar(bubble);
            scrollToBottom();
          }
        } catch (e) {}
      }
    }

    if (firstChunk) {
      bubble.classList.remove("is-thinking");
      bubble.innerHTML = formatContent(responseText || "（无回复）");
      attachCodeToolbar(bubble);
    }

    const copyBtn = assistantEl.querySelector(".msg-copy-btn");
    if (copyBtn) {
      copyBtn.onclick = function () {
        copyText(responseText || "", copyBtn);
      };
    }

chatHistory.push({
      role: "assistant",
      content: responseText || "（无回复）",
    });
  } catch (error) {
    console.error("Error:", error);
    bubble.classList.remove("is-thinking");
    bubble.innerHTML = formatContent("抱歉，处理请求时出现了错误。请稍后再试");
  } finally {
    isProcessing = false;
    userInput.disabled = false;
    attachBtn.disabled = false;
    updateSendButton();
    userInput.focus();
  }
}

function createMessageElement(role, content, attachments) {
  const messageEl = document.createElement("div");
  messageEl.className = "message " + role;

const avatar = document.createElement("div");
   avatar.className = "avatar";
   avatar.textContent = role === "assistant" ? "AI" : "你";

  const contentEl = document.createElement("div");
  contentEl.className = "message-content";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = formatContent(content);
  attachCodeToolbar(bubble);

// Add attachments preview if any
   if (attachments && attachments.length > 0) {
     const attachmentsEl = document.createElement("div");
     attachmentsEl.className = "message-attachments";
     attachmentsEl.style.cssText = "margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px;";
     attachmentsEl.innerHTML = attachments
       .map(
         (att, idx) => `
       <div class="attachment-item" data-index="${idx}" style="display: inline-flex; align-items: center; gap: 8px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 6px 10px; font-size: 13px; color: var(--text-primary); cursor: pointer;">
         ${att.isImage ? `<img src="data:${att.type};base64,${att.data}" alt="${escapeHtml(att.name)}" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover;" />` : `<span class="file-icon" style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: var(--accent-muted); color: var(--accent); border-radius: 4px; font-size: 10px; font-weight: 600;">${getFileIcon({ name: att.name })}</span>`}
         <span class="file-name" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
         <span class="file-size" style="color: var(--text-muted); font-size: 11px;">${formatFileSize(att.size)}</span>
         ${!att.isImage ? `<span class="preview-hint" style="color: var(--accent); font-size: 10px;">👁</span>` : ""}
       </div>
     `
       )
       .join("");
    contentEl.appendChild(attachmentsEl);

    // Add click handlers for preview (index-based lookup, covers images too)
    attachmentsEl.querySelectorAll(".attachment-item").forEach((item) => {
      item.addEventListener("click", () => {
        const att = attachments[parseInt(item.dataset.index)];
        if (att) openPreview(att);
      });
    });
  }

  const copyBtn = document.createElement("button");
  copyBtn.className = "msg-copy-btn";
  copyBtn.type = "button";
  copyBtn.title = "复制";
  copyBtn.innerHTML = COPY_ICON + "<span>复制</span>";
  copyBtn.onclick = function () {
    copyText(content, copyBtn);
  };

  contentEl.appendChild(bubble);
  contentEl.appendChild(copyBtn);
  messageEl.appendChild(avatar);
  messageEl.appendChild(contentEl);

  return messageEl;
}

function addMessageToChat(role, content, attachments, animate) {
  if (animate === undefined) animate = true;
  const el = createMessageElement(role, content, attachments);
  if (!animate) el.style.animation = "none";
  chatMessages.appendChild(el);
  scrollToBottom();
}

function attachCodeToolbar(bubble) {
  if (!bubble) return;
  const pres = bubble.querySelectorAll("pre");
  for (let i = 0; i < pres.length; i++) {
    const pre = pres[i];
    if (pre.querySelector(".code-toolbar")) continue;

    const code = pre.querySelector("code");
    const raw = code ? code.textContent : pre.textContent;
    const lang = (pre.getAttribute("data-lang") || "").toLowerCase();

    const toolbar = document.createElement("div");
    toolbar.className = "code-toolbar";

    if (lang && RUNNABLE[lang]) {
      const runBtn = document.createElement("button");
      runBtn.className = "code-run-btn";
      runBtn.type = "button";
      runBtn.title = "在浏览器中运行";
      runBtn.innerHTML = '<span class="play-icon"></span>';
      runBtn.onclick = function (e) {
        e.stopPropagation();
        openRunner(raw, lang);
      };
      toolbar.appendChild(runBtn);
    }

    const copyBtn = document.createElement("button");
    copyBtn.className = "code-copy-btn";
    copyBtn.type = "button";
    copyBtn.title = "复制代码";
    copyBtn.innerHTML = COPY_ICON + "<span>复制</span>";
    copyBtn.onclick = function (e) {
      e.stopPropagation();
      copyText(raw, copyBtn);
    };
    toolbar.appendChild(copyBtn);

    pre.appendChild(toolbar);

    // 语法高亮
    highlightCodeBlock(pre);
  }
}

function highlightCodeBlock(pre) {
  if (typeof hljs === "undefined") return;
  var code = pre.querySelector("code");
  if (!code || code.dataset.highlighted === "1") return;
  try {
    var lang = (pre.getAttribute("data-lang") || "").toLowerCase();
    if (lang === "cpp" || lang === "c++" || lang === "cxx" || lang === "cc") {
      code.className = "language-cpp";
    } else if (lang === "c") {
      code.className = "language-c";
    } else if (lang === "py" || lang === "python3") {
      code.className = "language-python";
    } else if (lang) {
      code.className = "language-" + lang;
    }
    hljs.highlightElement(code);
    code.dataset.highlighted = "1";
  } catch (e) {
    console.warn("highlight failed", e);
  }
}

function copyText(text, btn) {
  if (!text) return;

function onSuccess() {
    if (!btn) return;
    const original = btn.innerHTML;
    btn.classList.add("copied");
    btn.innerHTML = CHECK_ICON + "<span>已复制</span>";
    setTimeout(function () {
      btn.classList.remove("copied");
      btn.innerHTML = original;
    }, 1500);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(function () {
      fallbackCopy(text, onSuccess);
    });
  } else {
    fallbackCopy(text, onSuccess);
  }
}

function fallbackCopy(text, onSuccess) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    if (onSuccess) onSuccess();
  } catch (e) {
    console.error("Copy failed", e);
  }
  document.body.removeChild(ta);
}

function formatContent(text) {
  if (!text) return "";

  var html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
    var langLower = (lang || "").toLowerCase();
    var langAttr = langLower ? ' data-lang="' + langLower + '"' : "";
    var cls = langLower ? ' class="language-' + langLower + '"' : "";
    return "<pre" + langAttr + "><code" + cls + ">" + code.trim() + "</code></pre>";
  });

  var parts = html.split(/(<pre[\s\S]*?<\/pre>)/);

  html = parts
    .map(function (part) {
      if (part.indexOf("<pre") === 0) return part;

      part = part.replace(/`([^`]+)`/g, "<code>$1</code>");
      part = part.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      part = part.replace(/__(.+?)__/g, "<strong>$1</strong>");
      part = part.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
      part = part.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");
      part = part.replace(
        /^(\d+)\.\s+(.+)$/gm,
        '<div class="list-item"><span class="list-num">$1.</span> $2</div>'
      );
      part = part.replace(/^[-*]\s+(.+)$/gm, '<div class="list-item">• $1</div>');
      part = part.replace(/\n/g, "<br>");

      return part;
    })
    .join("");

  return html;
}

function scrollToBottom() {
  requestAnimationFrame(function () {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

/* ========== Browser-side Code Runner ========== */

function initRunnerModal() {
  const overlay = document.getElementById("runner-overlay");
  const closeBtn = document.getElementById("runner-close");
  const runBtn = document.getElementById("runner-run-btn");
  const clearOutputBtn = document.getElementById("runner-clear-output");
  const copyOutputBtn = document.getElementById("runner-copy-output");
  const templateSelect = document.getElementById("runner-template");
  const textarea = document.getElementById("runner-editor");

// 运行按钮绑定必须最先执行且绝不因其它元素缺失而中断
  if (!runBtn) {
    console.error("[chat.js] 未找到 #runner-run-btn，运行按钮不可用");
  } else {
    runBtn.addEventListener("click", executeCode);
  }

  if (!overlay || !textarea) {
    console.error("[chat.js] 运行器弹窗元素缺失", { overlay: !!overlay, textarea: !!textarea });
    return;
  }

  if (closeBtn) closeBtn.addEventListener("click", closeRunner);
  if (clearOutputBtn) clearOutputBtn.addEventListener("click", clearRunnerOutput);
  if (copyOutputBtn) copyOutputBtn.addEventListener("click", copyRunnerOutput);
  if (templateSelect) templateSelect.addEventListener("change", onTemplateSelect);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeRunner();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeRunner();
  });

  // CodeMirror：语法高吗+ Tab 缩进
  if (typeof CodeMirror !== "undefined") {
    runnerCM = CodeMirror.fromTextArea(textarea, {
      lineNumbers: true,
      theme: "material-darker",
      mode: "text/x-c++src",
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      lineWrapping: true,
      extraKeys: {
        Tab: function (cm) {
          if (cm.somethingSelected()) {
            cm.indentSelection("add");
          } else {
            cm.replaceSelection("    ", "end");
          }
        },
        "Shift-Tab": function (cm) {
          cm.indentSelection("subtract");
        },
      },
    });
    // 确保高度
    setTimeout(function () {
      if (runnerCM) runnerCM.refresh();
    }, 0);
  } else {
    // 降级：原吗textarea 支持 Tab
    textarea.addEventListener("keydown", function (e) {
      if (e.key === "Tab") {
        e.preventDefault();
        var start = this.selectionStart;
        var end = this.selectionEnd;
        var val = this.value;
        this.value = val.substring(0, start) + "    " + val.substring(end);
        this.selectionStart = this.selectionEnd = start + 4;
      }
    });
  }
}

// 代码模板
const RUNNER_TEMPLATES = {
  cpp_hello: `#include <iostream>
using namespace std;

int main() {
    cout << "Hello, World!" << endl;
    return 0;
}`,
  cpp_vector: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> v = {5, 2, 8, 1, 9};
    cout << "原始: ";
    for (int x : v) cout << x << " ";
    cout << endl;
    
    sort(v.begin(), v.end());
    cout << "排序吗 ";
    for (int x : v) cout << x << " ";
    cout << endl;
    
    v.push_back(10);
    cout << "添加10吗 ";
    for (int x : v) cout << x << " ";
    cout << endl;
    return 0;
}`,
  cpp_sort: `#include <iostream>
#include <vector>
#include <algorithm>
#include <functional>
using namespace std;

int main() {
    vector<int> v = {64, 34, 25, 12, 22, 11, 90};
    
    // 升序
    sort(v.begin(), v.end());
    cout << "升序: ";
    for (int x : v) cout << x << " ";
    cout << endl;
    
    // 降序
    sort(v.begin(), v.end(), greater<int>());
    cout << "降序: ";
    for (int x : v) cout << x << " ";
    cout << endl;
    
    return 0;
}`,
  cpp_string: `#include <iostream>
#include <string>
#include <algorithm>
using namespace std;

int main() {
    string s = "Hello, C++!";
    cout << "原字符串: " << s << endl;
    cout << "长度: " << s.size() << endl;
    
    string s2 = s.substr(7, 3); // "C++"
    cout << "substr(7,3): " << s2 << endl;
    
    s.append(" Welcome!");
    cout << "append吗 " << s << endl;
    
    // 查找
    size_t pos = s.find("C++");
    cout << "find 'C++': " << pos << endl;
    
    return 0;
}`,
  cpp_nested: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    // 二维向量
    vector<vector<int>> matrix = {
        {1, 2, 3},
        {4, 5, 6},
        {7, 8, 9}
    };
    
    cout << "矩阵:" << endl;
    for (auto& row : matrix) {
        for (int x : row) cout << x << " ";
        cout << endl;
    }
    
    // 动态添加行（使用临时变量避免初始化列表问题）
    vector<int> newRow = {10, 11, 12};
    matrix.push_back(newRow);
    cout << "\\n添加行后:" << endl;
    for (auto& row : matrix) {
        for (int x : row) cout << x << " ";
        cout << endl;
    }
    
    // 访问元素
    cout << "\\nmatrix[1][2] = " << matrix[1][2] << endl;
    return 0;
}`,
  c_hello: `#include <stdio.h>

int main() {
    printf("Hello, World!\\n");
    return 0;
}`,
  py_hello: `print("Hello, World!")

# 列表推导式
squares = [x**2 for x in range(10)]
print("Squares:", squares)

# 字典
person = {"name": "Alice", "age": 30}
print(f"Name: {person['name']}, Age: {person['age']}")`,
  py_fib: `def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b

print("Fibonacci(10):", list(fibonacci(10)))

# 生成器表达式
sum_squares = sum(x*x for x in range(100))
print("Sum of squares 0-99:", sum_squares)`,
  cpp_algorithms: `#include <iostream>
#include <vector>
#include <algorithm>
#include <numeric>
#include <iterator>
using namespace std;

int main() {
    vector<int> v = {5, 2, 8, 1, 9, 3, 7, 4, 6};
    
    cout << "原始: ";
    for (int x : v) cout << x << " ";
    cout << endl;
    
    // 排序算法
    sort(v.begin(), v.end());
    cout << "升序: ";
    for (int x : v) cout << x << " ";
    cout << endl;
    
    sort(v.begin(), v.end(), greater<int>());
    cout << "降序: ";
    for (int x : v) cout << x << " ";
    cout << endl;
    
    // 搜索
    auto it = find(v.begin(), v.end(), 5);
    cout << "找到5: " << (it != v.end() ? "是" : "否") << " 位置: " << (it - v.begin()) << endl;
    
    // 统计
    int count5 = count(v.begin(), v.end(), 5);
    cout << "5出现次数: " << count5 << endl;
    
    // 统计算法
    int sum = accumulate(v.begin(), v.end(), 0);
    int min_val = *min_element(v.begin(), v.end());
    int max_val = *max_element(v.begin(), v.end());
    cout << "总和 " << sum << ", 最小值 " << min_val << ", 最大值 " << max_val << endl;
    
    // 二分查找
    sort(v.begin(), v.end());
    bool found = binary_search(v.begin(), v.end(), 5);
    cout << "二分查找5: " << (found ? "找到" : "未找到") << endl;
    
    // 堆操作
    vector<int> h = {3, 1, 4, 1, 5, 9, 2, 6};
    make_heap(h.begin(), h.end());
    cout << "堆顶: " << h.front() << endl;
    pop_heap(h.begin(), h.end());
    h.pop_back();
    cout << "弹出后堆顶 " << h.front() << endl;
    
    return 0;
}`,
  cpp_string_advanced: `#include <iostream>
#include <string>
#include <algorithm>
using namespace std;

int main() {
    string s = "Hello, C++!";
    cout << "原字符串: " << s << endl;
    cout << "长度: " << s.size() << endl;
    
    // C++20 新方法
    cout << "starts_with 'Hel': " << (s.starts_with("Hel") ? "是" : "否") << endl;
cout << "ends_with '++!': " << (s.ends_with("++!") ? "是" : "否") << endl;
    cout << "contains 'C++': " << (s.find("C++") != string::npos ? "是" : "否") << endl;
    
    // 大小写转换
    string lower = s;
    transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
    cout << "小写: " << lower << endl;
    
    string upper = s;
    transform(upper.begin(), upper.end(), upper.begin(), ::toupper);
    cout << "大写: " << upper << endl;
    
// 修剪
    string trimmed = "  hello world  ";
    cout << "修剪前 '" << trimmed << "'" << endl;
    // 简化版 trim
    auto start = trimmed.find_first_not_of(" ");
    auto end = trimmed.find_last_not_of(" ");
    if (start != string::npos) trimmed = trimmed.substr(start, end - start + 1);
    else trimmed = "";
    cout << "修剪后 '" << trimmed << "'" << endl;
    
    // 大小写转换
    string s2 = "hello";
s2[0] = toupper(s2[0]);
    cout << "首字母大写 " << s2 << endl;
    
    // 重复
    string repeated = "ab";
for (int i = 1; i < 3; i++) s2 += repeated;
    cout << "重复3次 " << s2 << endl;
    
    return 0;
}`,
  cpp_heap: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> v = {3, 1, 4, 1, 5, 9, 2, 6, 5};
    
    cout << "原始: ";
    for (int x : v) cout << x << " ";
    cout << endl;
    
    // make_heap - 构建最大堆
    make_heap(v.begin(), v.end());
    cout << "堆顶 (最大值): " << v.front() << endl;
    
    // push_heap
    v.push_back(10);
    push_heap(v.begin(), v.end());
    cout << "push 10 后堆顶 " << v.front() << endl;
    
    // pop_heap
    pop_heap(v.begin(), v.end());
int max_val = v.back();
    v.pop_back();
    cout << "弹出最大值 " << max_val << ", 新堆顶 " << v.front() << endl;
    
// sort_heap - 将堆转为有序序列
    sort_heap(v.begin(), v.end());
    cout << "sort_heap 后 ";
    for (int x : v) cout << x << " ";
    cout << endl;
    
    // is_heap
    vector<int> h = {9, 7, 5, 3, 1};
    make_heap(h.begin(), h.end());
    cout << "is_heap: " << (is_heap(h.begin(), h.end()) ? "是" : "否") << endl;
    
    // is_heap_until
    h[2] = 10; // 破坏堆性质
    auto it = is_heap_until(h.begin(), h.end());
    cout << "is_heap_until 位置: " << (it - h.begin()) << endl;
    
    return 0;
}`,
  cpp_random: `#include <iostream>
#include <random>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    // 随机数引擎    random_device rd;
    mt19937 gen(rd()); // 梅森旋转算法
    
    // 均匀分布
    uniform_int_distribution<> dis_int(1, 100);
    cout << "随机整数 (1-100): ";
    for (int i = 0; i < 5; i++) cout << dis_int(gen) << " ";
    cout << endl;
    
    uniform_real_distribution<> dis_real(0.0, 1.0);
    cout << "随机浮点数(0-1): ";
    for (int i = 0; i < 5; i++) cout << dis_real(gen) << " ";
    cout << endl;
    
    // 正态分布    normal_distribution<> dis_norm(0.0, 1.0);
    cout << "正态分布(均值, 标准差): ";
    for (int i = 0; i < 5; i++) cout << dis_norm(gen) << " ";
    cout << endl;
    
    // 打乱序列
    vector<int> cards = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
    random_device rd2;
    mt19937 gen2(rd2());
    shuffle(cards.begin(), cards.end(), gen2);
    cout << "洗牌后 ";
    for (int x : cards) cout << x << " ";
    cout << endl;
    
    // sample (C++17)
    vector<int> population = {1,2,3,4,5,6,7,8,9,10};
    vector<int> sample_out;
    sample(population.begin(), population.end(), back_inserter(sample_out), 5, gen);
    cout << "随机采样5个 ";
    for (int x : sample_out) cout << x << " ";
    cout << endl;
    
    return 0;
}`,
  cpp_math: `#include <iostream>
#include <cmath>
#include <algorithm>
using namespace std;

int main() {
    cout << "数学函数演示:" << endl;
    
    double x = 2.5;
    cout << "x = " << x << endl;
    cout << "sin: " << sin(x) << ", cos: " << cos(x) << ", tan: " << tan(x) << endl;
    cout << "asin: " << asin(0.5) << ", acos: " << acos(0.5) << ", atan: " << atan(1.0) << endl;
    cout << "atan2(1,1): " << atan2(1.0, 1.0) << endl;
    
    cout << "exp(1): " << exp(1.0) << ", log(e): " << log(exp(1.0)) << endl;
    cout << "log10(100): " << log10(100.0) << ", log2(8): " << log2(8.0) << endl;
    cout << "sqrt(16): " << sqrt(16.0) << ", cbrt(27): " << cbrt(27.0) << endl;
    cout << "pow(2,10): " << pow(2.0, 10.0) << ", hypot(3,4): " << hypot(3.0, 4.0) << endl;
    
    cout << "ceil(2.3): " << ceil(2.3) << ", floor(2.3): " << floor(2.3) << endl;
    cout << "round(2.5): " << round(2.5) << ", trunc(2.7): " << trunc(2.7) << endl;
    cout << "fmod(10,3): " << fmod(10.0, 3.0) << ", remainder: " << remainder(10.0, 3.0) << endl;
    cout << "fmax(2,5): " << fmax(2.0, 5.0) << ", fmin(2,5): " << fmin(2.0, 5.0) << endl;
    cout << "copysign(3,-2): " << copysign(3.0, -2.0) << endl;
    
    // 双曲函数
    cout << "sinh(1): " << sinh(1.0) << ", cosh(1): " << cosh(1.0) << ", tanh(1): " << tanh(1.0) << endl;
    cout << "asinh(1): " << asinh(1.0) << ", acosh(2): " << acosh(2.0) << endl;
    
    return 0;
}`,
  cpp_set_ops: `#include <iostream>
#include <vector>
#include <algorithm>
#include <iterator>
using namespace std;

int main() {
    vector<int> a = {1, 3, 5, 7, 9};
    vector<int> b = {2, 3, 5, 7, 11};
    vector<int> result;
    
    cout << "A: ";
    for (int x : a) cout << x << " ";
    cout << endl;
    cout << "B: ";
    for (int x : b) cout << x << " ";
    cout << endl;
    
    // set_union
    result.clear();
    set_union(a.begin(), a.end(), b.begin(), b.end(), back_inserter(result));
    cout << "并集: ";
    for (int x : result) cout << x << " ";
    cout << endl;
    
    // set_intersection
    result.clear();
    set_intersection(a.begin(), a.end(), b.begin(), b.end(), back_inserter(result));
    cout << "交集: ";
    for (int x : result) cout << x << " ";
    cout << endl;
    
    // set_difference
    result.clear();
    set_difference(a.begin(), a.end(), b.begin(), b.end(), back_inserter(result));
    cout << "差集 A-B: ";
    for (int x : result) cout << x << " ";
    cout << endl;
    
    // set_symmetric_difference
    result.clear();
    set_symmetric_difference(a.begin(), a.end(), b.begin(), b.end(), back_inserter(result));
    cout << "对称差集: ";
    for (int x : result) cout << x << " ";
    cout << endl;
    
    // includes
    vector<int> sub = {3, 5, 7};
    cout << "includes A包含sub: " << (includes(a.begin(), a.end(), sub.begin(), sub.end()) ? "是" : "否") << endl;
    
    // equal
    vector<int> same = {1, 3, 5, 7, 9};
    cout << "equal A==same: " << (equal(a.begin(), a.end(), same.begin()) ? "是" : "否") << endl;
    
    // mismatch
    vector<int> diff = {1, 3, 4, 7, 9};
    auto mm = mismatch(a.begin(), a.end(), diff.begin());
    cout << "mismatch 位置: " << (mm.first - a.begin()) << endl;
    
    // lexicographical_compare
    vector<int> v1 = {1, 2, 3};
    vector<int> v2 = {1, 2, 4};
    cout << "lexicographical_compare: " << (lexicographical_compare(v1.begin(), v1.end(), v2.begin(), v2.end()) ? "v1<v2" : "v1>=v2") << endl;
    
    return 0;
}`,
  cpp_partition: `#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> v = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
    
    cout << "原始: ";
    for (int x : v) cout << x << " ";
    cout << endl;
    
    // partition - 将偶数移到前面
    auto mid = partition(v.begin(), v.end(), [](int x) { return x % 2 == 0; });
    cout << "partition 后(偶数在前): ";
    for (auto it = v.begin(); it != v.end(); ++it) cout << *it << " ";
    cout << endl;
    cout << "偶数部分: ";
    for (auto it = v.begin(); it != mid; ++it) cout << *it << " ";
    cout << endl;
    
    // stable_partition - 保持相对顺序
    vector<int> v2 = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
    auto mid2 = stable_partition(v2.begin(), v2.end(), [](int x) { return x % 2 == 0; });
    cout << "stable_partition 后 ";
    for (auto it = v2.begin(); it != v2.end(); ++it) cout << *it << " ";
    cout << endl;
    
    // nth_element - 找到中位数
    vector<int> v3 = {9, 1, 5, 3, 7, 2, 8, 4, 6};
    nth_element(v3.begin(), v3.begin() + v3.size() / 2, v3.end());
    cout << "中位数 " << v3[v3.size() / 2] << endl;
    
    // partial_sort - 只排前3 个最小
    vector<int> v4 = {9, 1, 5, 3, 7, 2, 8, 4, 6};
    partial_sort(v4.begin(), v4.begin() + 3, v4.end());
    cout << "partial_sort 前3最小 ";
    for (int i = 0; i < 3; i++) cout << v4[i] << " ";
    cout << endl;
    
    // is_sorted
    vector<int> sorted = {1, 2, 3, 4, 5};
    vector<int> unsorted = {1, 3, 2, 4, 5};
cout << "is_sorted sorted: " << (is_sorted(sorted.begin(), sorted.end()) ? "是" : "否") << endl;
    cout << "is_sorted unsorted: " << (is_sorted(unsorted.begin(), unsorted.end()) ? "是" : "否") << endl;
    
    // is_sorted_until
    auto unsorted_it = is_sorted_until(unsorted.begin(), unsorted.end());
    cout << "is_sorted_until 位置: " << (unsorted_it - unsorted.begin()) << endl;
    
    return 0;
}`,
  cpp_string_extra: `#include <iostream>
#include <string>
#include <vector>
using namespace std;

int main() {
    string s = "  Hello, C++ World!  ";
    cout << "原字符串: '" << s << "'" << endl;
    
    // C++20 新方法
    cout << "starts_with 'He': " << (s.starts_with("He") ? "是" : "否") << endl;
cout << "ends_with 'ld!': " << (s.ends_with("ld!") ? "是" : "否") << endl;
    cout << "contains 'C++': " << (s.find("C++") != string::npos ? "是" : "否") << endl;
    
    // 修剪
    string trimmed = s;
    auto start = trimmed.find_first_not_of(" \t\n\r");
    auto end = trimmed.find_last_not_of(" \t\n\r");
    if (start != string::npos) trimmed = trimmed.substr(start, end - start + 1);
    else trimmed = "";
    cout << "trim: '" << trimmed << "'" << endl;
    
    // 大小写转换
    string lower = "HELLO WORLD";
    transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
    cout << "to_lower: " << lower << endl;
    
    string upper = "hello world";
    transform(upper.begin(), upper.end(), upper.begin(), ::toupper);
    cout << "to_upper: " << upper << endl;
    
    // 重复
    string rep = "ab";
    string repeated = rep;
    for (int i = 1; i < 3; i++) repeated += rep;
    cout << "repeat 3: " << repeated << endl;
    
    // pad
    string num = "42";
    string padded = string(5 - num.length(), '0') + num;
    cout << "pad_start: " << padded << endl;
    
    // split (简化版)
    string csv = "apple,banana,orange,grape";
    size_t pos = 0;
    string token;
    while ((pos = csv.find(',')) != string::npos) {
        cout << "split: " << csv.substr(0, pos) << endl;
        csv.erase(0, pos + 1);
    }
    cout << "last: " << csv << endl;
    
    // replace
    string replace_demo = "I like apples";
    size_t pos = replace_demo.find("apples");
    if (pos != string::npos) replace_demo.replace(pos, 6, "oranges");
    cout << "replace: " << replace_demo << endl;
    
    // rfind
    string path = "/home/user/documents/file.txt";
    size_t last_slash = path.rfind('/');
    cout << "文件名 " << path.substr(last_slash + 1) << endl;
    
    // split + join
    vector<string> parts = {"a", "b", "c"};
    string joined;
    for (size_t i = 0; i < parts.size(); i++) {
        if (i > 0) joined += "-";
        joined += parts[i];
    }
    cout << "join: " << joined << endl;
    
    return 0;
}`,
};

function onTemplateSelect(e) {
  const key = e.target.value;
  if (!key) return;
  const code = RUNNER_TEMPLATES[key];
  if (code) {
    setRunnerCode(code);
    // 根据模板自动切换语言模式
    if (key.startsWith("cpp") || key.startsWith("c_")) {
      runnerLangKey = key.startsWith("c_") ? "c" : "cpp";
    } else if (key.startsWith("py")) {
      runnerLangKey = "python";
    }
    setRunnerMode(runnerLangKey);
    const label = LANG_LABEL[runnerLangKey] || runnerLangKey;
    document.getElementById("runner-lang-label").textContent = label;
  }
  e.target.value = ""; // 重置选择
}

function clearRunnerOutput() {
  const output = document.getElementById("runner-output");
  if (output) {
    output.textContent = "点击「运行」在浏览器中执行（无需外部 API）";
    output.className = "";
  }
}

function copyRunnerOutput() {
  const output = document.getElementById("runner-output");
  const btn = document.getElementById("runner-copy-output");
  if (output) {
    copyText(output.textContent, btn);
  }
}

function getRunnerCode() {
  if (runnerCM) return runnerCM.getValue();
  return document.getElementById("runner-editor").value;
}

function setRunnerCode(code) {
  if (runnerCM) {
    runnerCM.setValue(code || "");
    runnerCM.refresh();
  } else {
    document.getElementById("runner-editor").value = code || "";
  }
}

function setRunnerMode(langKey) {
  if (!runnerCM) return;
  var mode = "text/x-c++src";
  if (isPython(langKey)) mode = "python";
  else if (langKey === "c") mode = "text/x-csrc";
  else mode = "text/x-c++src";
  runnerCM.setOption("mode", mode);
}

/**
 * C++ 兼容层已移至 public/vendor/jscpp-compat.js
 * 通过 window.JSCPPCompat 提供 preprocess / installSTLShimTypes 吗API吗 * 此处仅保留薄包装，保吗chat.js 调用方式不变吗 */
function preprocessCppForJSCPP(code) {
  if (typeof JSCPPCompat === "undefined" || typeof JSCPPCompat.preprocess !== "function") {
    throw new Error("JSCPP 兼容层未加载，请确认 /vendor/jscpp-compat.js 已正确引入");
  }
  return JSCPPCompat.preprocess(code);
}

function installSTLShimTypes(rt, registrations) {
  if (typeof JSCPPCompat !== "undefined" && typeof JSCPPCompat.installSTLShimTypes === "function") {
    return JSCPPCompat.installSTLShimTypes(rt, registrations);
  }
  throw new Error("JSCPPCompat.installSTLShimTypes 不可用");
}

// 兼容旧代码对 __pendingSTLRegistrations 的直接访问
Object.defineProperty(window, "__pendingSTLRegistrations", {
  get: function () {
    return (typeof JSCPPCompat !== "undefined" && JSCPPCompat.getPendingSTLRegistrations)
      ? JSCPPCompat.getPendingSTLRegistrations()
      : [];
  },
  set: function (v) {
    if (typeof JSCPPCompat !== "undefined" && JSCPPCompat.setPendingSTLRegistrations) {
      JSCPPCompat.setPendingSTLRegistrations(v);
    }
  },
  configurable: true,
});

function isPython(lang) {
  return lang === "python" || lang === "py" || lang === "python3";
}

function isCppFamily(lang) {
  return lang === "c" || lang === "cpp" || lang === "c++" || lang === "cxx" || lang === "cc";
}

function openRunner(code, langKey) {
  runnerLangKey = (langKey || "python").toLowerCase();
  runnerSource = code || "";

  const label = LANG_LABEL[runnerLangKey] || runnerLangKey;
  document.getElementById("runner-lang-label").textContent = label;
  setRunnerCode(runnerSource);
  setRunnerMode(runnerLangKey);
  // 标准输入已改为终端内交互，不再有 #runner-stdin 输入框
  const out = document.getElementById("runner-output");
  out.textContent = "点击「运行」在浏览器中执行（无需外部 API）";
  out.className = "";

  document.getElementById("runner-overlay").classList.add("open");
  setTimeout(function () {
    if (runnerCM) {
      runnerCM.refresh();
      runnerCM.focus();
    } else {
      document.getElementById("runner-editor").focus();
    }
  }, 50);
}

function closeRunner() {
  document.getElementById("runner-overlay").classList.remove("open");
}

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = function () {
      resolve();
    };
    s.onerror = function () {
      reject(new Error("加载脚本失败: " + src));
    };
    document.head.appendChild(s);
  });
}

async function ensurePyodide() {
  if (pyodideInstance) return pyodideInstance;
  if (pyodideLoading) return pyodideLoading;

  pyodideLoading = (async function () {
    if (typeof loadPyodide !== "function") {
      await loadScript("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");
    }
    const pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
    });
    pyodideInstance = pyodide;
    return pyodide;
  })();

  try {
    return await pyodideLoading;
  } catch (e) {
    pyodideLoading = null;
    throw e;
  }
}

var __stdinLines = [];
var __terminalEcho = "";
var __inputWaiter = null;

async function runPython(source, stdin) {
  return window.JSCPPCompat.CompilerRuntime.runPython(source, stdin);
}

async function runCppOrC(source, stdin) {
  return window.JSCPPCompat.CompilerRuntime.runCppOrC(source, stdin);
}

async function executeCode() {
  const output = document.getElementById("runner-output");
  const runBtn = document.getElementById("runner-run-btn");

  let source = getRunnerCode();
  if (!source.trim()) {
    output.textContent = "请先输入代码";
    output.className = "error";
    return;
  }

  // 标准输入现在完全在终端内交互进行，不再需要预填
  let stdin = "";

  runBtn.disabled = true;
  output.className = "running";

  const startTime = performance.now();

  try {
    let result;

    if (isPython(runnerLangKey)) {
      output.textContent = "正在加载 Python 运行时（首次较慢）";
      result = await runPython(source, stdin);
} else if (isCppFamily(runnerLangKey)) {
      output.textContent = "正在加载 C/C++ 解释器…";
      // 必须先 ensureJSCPP（会加载 jscpp-compat.js），再预处理
      await window.JSCPPCompat.CompilerRuntime.ensureJSCPP();
      source = preprocessCppForJSCPP(source);
      result = await runCppOrC(source, stdin);
    } else {
      output.textContent = "暂不支持该语言，仅支持 Python / C / C++";
      output.className = "error";
      return;
    }

    const endTime = performance.now();
    const execTime = (endTime - startTime).toFixed(2);

    var text = "";
    var isError = false;
    if (result.stdout) text += result.stdout;
    if (result.stderr) {
      if (text && !text.endsWith("\n")) text += "\n";
      text += result.stderr;
      isError = true;
    }
    if (!text.trim()) text = "(无输出)";

    // 添加执行时间信息
    text += "\n\n执行时间: " + execTime + " ms";

    output.textContent = text;
    output.className = isError ? "error" : "";
  } catch (err) {
    const endTime = performance.now();
    const execTime = (endTime - startTime).toFixed(2);
    
    console.error(err);
    let errorMsg = err.message || String(err);
    let userMsg = "运行失败: " + errorMsg;
    
    // 提供更友好的错误提示
if (errorMsg.includes("Parsing Failure") || errorMsg.includes("syntax")) {
      userMsg += "\n\n💡 语法错误建议：\n" +
        "检查分号、括号是否匹配\n" +
        "确认变量声明类型正确\n" +
        "JSCPP 不支持完整 C++ 标准，部分高级特性不可用";
} else if (errorMsg.includes("Maximum call stack size exceeded") || errorMsg.includes("stack overflow")) {
      userMsg += "\n\n💡 递归过深：\n" +
        "递归深度超过浏览器限制\n" +
        "请改用迭代方式或增加栈大小";
} else if (errorMsg.includes("不支持的") || errorMsg.includes("unsupported")) {
      userMsg += "\n\n💡 当前不支持的特性：\n" +
        "Lambda 表达式、std::function\n" +
        "多线程、原子操作、正则表达式\n" +
        "文件系统、日期时间库\n" +
        "建议使用 vector/array + 普通循环替代";
} else if (errorMsg.includes("out of range") || errorMsg.includes("subscript")) {
      userMsg += "\n\n💡 数组/容器越界：\n" +
        "检查循环边界条件\n" +
        "确认 vector 大小后再访问";
    }
    
userMsg += "\n\n执行时间: " + execTime + " ms";
    userMsg += "\n\n说明: 代码在浏览器本地执行。\n" +
      "Python 使用 Pyodide；C/C++ 使用 JSCPP（支持常用子集，非完整编译器）。\n" +
      "已自动适配 #include <bits/stdc++.h>、vector/string/algorithm 等大量头文件，\n" +
      "以及基础 auto 类型推导、vector/queue/stack/pair 容器、range-based for。\n" +
      "现在支持 map/set 模拟（基于 vector 实现）。\n" +
      "输入交互：程序运行到输入语句时，会在下方终端暂停等待输入（类似 Windows CMD）";
    
    output.textContent = userMsg;
    output.className = "error";
  } finally {
    runBtn.disabled = false;
  }
}


