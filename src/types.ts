/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
  /**
   * Binding for the Workers AI API.
   */
  AI: Ai;

  /**
   * Binding for static assets.
   */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/**
 * Represents a file attachment in a chat message.
 */
export interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  data: string; // base64 for images, text content for text files
  isImage: boolean;
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}

/**
 * Request body for chat API with optional attachments.
 */
export interface ChatRequest {
  messages: ChatMessage[];
}
