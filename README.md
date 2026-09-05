# Grok-style LLM Chat App (Cloudflare Workers AI)

一个现代化的 AI 聊天应用模板，由 **Cloudflare Workers AI** 驱动，UI 风格参考 Grok，深色、简洁、流畅。

## 特性

- 🎨 **现代化深色 UI**：接近 Grok 的视觉风格
- ⚡ **实时流式响应**（Server-Sent Events）
- 🧠 **Cloudflare Workers AI**（默认 Llama 3.3 70B）
- 📱 完美响应式（手机 + 桌面）
- 💬 客户端维护聊天历史
- 🧹 一键清空对话
- ✍️ 轻量 Markdown 支持（代码块、行内代码）
- 🔍 内置 Observability 日志

## 快速开始

### 前置要求

- Node.js v18+
- Wrangler CLI
- 拥有 Workers AI 权限的 Cloudflare 账号

### 安装

```bash
npm install
npm run cf-typegen
```

### 本地开发

```bash
npm run dev
```

访问 http://localhost:8787

> 注意：即使在本地开发，使用 Workers AI 也会产生费用。

### 部署

```bash
npm run deploy
```

## 项目结构

```
/
├── public/
│   ├── index.html      # 现代化聊天 UI
│   └── chat.js         # 前端逻辑（流式处理）
├── src/
│   ├── index.ts        # Worker 入口 + API
│   └── types.ts
├── wrangler.jsonc
└── README.md
```

## 自定义

### 更换模型

编辑 `src/index.ts` 中的 `MODEL_ID`：

```ts
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
```

可在 [Workers AI Models](https://developers.cloudflare.com/workers-ai/models/) 查看可用模型。

### 修改系统提示词

编辑 `src/index.ts` 中的 `SYSTEM_PROMPT`。

### 启用 AI Gateway

在 `src/index.ts` 中取消注释 gateway 配置，并填入你的 Gateway ID。

## 技术栈

- Cloudflare Workers + Workers AI
- 纯原生 HTML / CSS / JS（无构建依赖）
- Server-Sent Events 流式输出

---

Powered by Cloudflare Workers AI · UI inspired by Grok
