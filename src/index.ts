/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage, ChatRequest } from "./types";

// Model IDs for Workers AI models
// https://developers.cloudflare.com/workers-ai/models/
const TEXT_MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL_ID = "@cf/meta/llama-3.2-11b-vision-instruct";

// Default system prompt
const SYSTEM_PROMPT =
  "You are a helpful, friendly AI assistant. Be clear and direct. Provide accurate and useful responses. Respond in the same language the user is using. When writing code, always use fenced code blocks with a language tag (python, c, or cpp) so the user can run it online.";

// Vision license agreement state (per-isolate, not global across requests)
const visionLicenseAccepted = new WeakMap<object, boolean>();

export default {
  /**
   * Main request handler for the Worker
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle static assets (frontend)
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // API Routes
    if (url.pathname === "/api/chat") {
      // Handle POST requests for chat
      if (request.method === "POST") {
        return handleChatRequest(request, env);
      }

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    // Handle 404 for unmatched routes
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * Check if the latest user message has image attachments
 */
function hasImageAttachments(messages: ChatMessage[]): boolean {
  // Only check the last user message to avoid triggering vision model for history
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      return msg.attachments?.some((att) => att.isImage) ?? false;
    }
  }
  return false;
}

/**
 * Extract the first image attachment from the latest user message
 */
function extractImageAttachment(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user" && msg.attachments) {
      const imageAtt = msg.attachments.find((a) => a.isImage);
      if (imageAtt) {
        return `data:${imageAtt.type};base64,${imageAtt.data}`;
      }
    }
  }
  return null;
}

/**
 * Build text-only messages, embedding text attachment contents into message content.
 * Used for BOTH text model and vision model (image passed separately for vision).
 */
function buildTextMessages(messages: ChatMessage[]): any[] {
  const MAX_TOTAL_CHARS = 60000; // total attachment char budget per request
  let budget = MAX_TOTAL_CHARS;

  return messages.map((msg) => {
    if (msg.attachments && msg.attachments.length > 0) {
      const textAttachments = msg.attachments.filter((a) => !a.isImage);

      // Fallback content when user sends attachments without typing text
      let content =
        msg.content ||
        (textAttachments.length > 0 ? "请分析我上传的文件内容。" : "");

      // Embed text file contents (with truncation to protect model context)
      for (const att of textAttachments) {
        if (budget <= 0) {
          content += `\n\n[文件: ${att.name}]\n[未发送：已达单次请求的附件内容上限]`;
          continue;
        }
        let data = att.data;
        if (data.length > budget) {
          data =
            data.slice(0, budget) +
            `\n[...文件过长已截断，完整大小 ${att.data.length} 字符...]`;
        }
        budget -= data.length;
        content += `\n\n[文件: ${att.name}]\n${data}`;
      }

      return { role: msg.role, content };
    }
    return { role: msg.role, content: msg.content };
  });
}

/**
 * Handles chat API requests
 */
async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // Parse JSON request body
    const { messages = [] } = (await request.json()) as ChatRequest;

    // Add system prompt if not present (create new array to avoid mutating original)
    const messagesWithSystem = messages.some((msg) => msg.role === "system")
      ? messages
      : [{ role: "system" as const, content: SYSTEM_PROMPT }, ...messages];

    // Choose model based on attachments
    const useVision = hasImageAttachments(messagesWithSystem);
    const modelId = useVision ? VISION_MODEL_ID : TEXT_MODEL_ID;

    // Check if vision model needs license agreement (one-time per isolate)
    if (useVision && !visionLicenseAccepted.get(env.AI)) {
      try {
        await env.AI.run(VISION_MODEL_ID, { prompt: "agree" });
        visionLicenseAccepted.set(env.AI, true);
      } catch (e) {
        console.warn("Vision license agreement failed:", e);
      }
    }

    // buildTextMessages embeds text attachment contents into message content.
    // It is used for BOTH paths - the text-only path previously dropped
    // attachments entirely (main bug: AI never received file contents).
    const builtMessages = buildTextMessages(messagesWithSystem);

    let inputs: any;
    if (useVision) {
      inputs = {
        messages: builtMessages,
        max_tokens: 1024,
        stream: true,
      };
      const imageBase64 = extractImageAttachment(messagesWithSystem);
      if (imageBase64) {
        // Full data URL format as per Cloudflare docs
        inputs.image = imageBase64;
      }
    } else {
      inputs = {
        messages: builtMessages,
        max_tokens: 1024,
        stream: true,
      };
    }

    const stream = await env.AI.run(modelId, inputs, {
      // Uncomment to use AI Gateway
      // gateway: {
      //   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
      //   skipCache: false,      // Set to true to bypass cache
      //   cacheTtl: 3600,        // Cache time-to-live in seconds
      // },
    });

    return new Response(stream as ReadableStream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}
