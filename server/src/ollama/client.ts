/**
 * Ollama client - typed wrapper around Ollama's HTTP API
 * Ollama is running at 127.0.0.1:11434
 */

/** Tool definition for Ollama tool calling */
export interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Tool call returned by Ollama in a chat response */
export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
}

export interface OllamaTagsResponse {
  models: OllamaModel[];
}

export interface OllamaPsProcess {
  name: string;
  model: string;
  size: number;
  digest: string;
  details: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
  expires_at: string;
  size_vram: number;
}

export interface OllamaPsResponse {
  models: OllamaPsProcess[];
}

export interface OllamaGenerateRequest {
  model: string;
  prompt?: string;
  keep_alive?: number;
  stream?: boolean;
  options?: { num_ctx?: number; [k: string]: unknown };
}

/**
 * What callers may choose for a chat. stream is fixed by
 * `chat()` (I10), and keep_alive defaults to -1 (FR4), so they are not
 * required. format, options, think, and keep_alive may be overridden per-request.
 */
export interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    tool_calls?: OllamaToolCall[];
    tool_name?: string;
  }>;
  format?: Record<string, unknown> | "json";
  options?: { num_ctx?: number; [k: string]: unknown };
  think?: boolean;
  keep_alive?: number | string;
}

export interface OllamaShowResponse {
  capabilities?: string[];
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: "assistant";
    content: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
}

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";

/**
 * A non-OK response from Ollama. `message` is Ollama's own `error` field
 * (from a JSON `{"error": "<text>"}` body) when present, else the response's
 * status text. Kept distinguishable from a network failure (fetch rejecting),
 * which throws a plain Error/TypeError instead.
 */
export class OllamaError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OllamaError";
    this.status = status;
  }
}

/**
 * Read a non-OK response body for Ollama's `error` text, falling back to the
 * status text (e.g. "Not Found") when the body is absent or not JSON with an
 * `error` field.
 */
async function ollamaErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        typeof (parsed as Record<string, unknown>).error === "string"
      ) {
        return (parsed as Record<string, unknown>).error as string;
      }
    } catch {
      // Not JSON; fall through to statusText.
    }
  }
  return response.statusText || `HTTP ${response.status}`;
}

export class OllamaClient {
  private baseUrl: string;
  /** Per-model "supports thinking" cache, kept for the life of the process (I9). */
  private thinkingSupport: Map<string, boolean> = new Map();

  constructor(baseUrl: string = OLLAMA_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Get list of all installed models
   */
  async tags(): Promise<OllamaTagsResponse> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama /api/tags failed: ${response.status}`);
    }
    return (await response.json()) as OllamaTagsResponse;
  }

  /**
   * Get currently resident (loaded) models
   */
  async ps(): Promise<OllamaPsResponse> {
    const response = await fetch(`${this.baseUrl}/api/ps`);
    if (!response.ok) {
      throw new Error(`Ollama /api/ps failed: ${response.status}`);
    }
    return (await response.json()) as OllamaPsResponse;
  }

  /**
   * Load or unload a model by sending a generate request with keep_alive
   * keep_alive: -1 means keep resident indefinitely
   * keep_alive: 0 means unload immediately
   */
  async generate(request: OllamaGenerateRequest): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new OllamaError(response.status, await ollamaErrorMessage(response));
    }

    // Consume the response
    await response.text();
  }

  /**
   * Load a model: keep it resident indefinitely (I9/I10).
   */
  async load(name: string, options?: OllamaGenerateRequest["options"]): Promise<void> {
    await this.generate(
      options === undefined ? { model: name, keep_alive: -1 } : { model: name, keep_alive: -1, options }
    );
  }

  /**
   * Unload a model immediately (I9/I10).
   */
  async unload(name: string): Promise<void> {
    await this.generate({ model: name, keep_alive: 0 });
  }

  /**
   * Get model details, including `capabilities` (e.g. "thinking") (I9).
   */
  async show(name: string): Promise<OllamaShowResponse> {
    const response = await fetch(`${this.baseUrl}/api/show`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: name }),
    });

    if (!response.ok) {
      throw new OllamaError(response.status, await ollamaErrorMessage(response));
    }

    return (await response.json()) as OllamaShowResponse;
  }

  /**
   * Whether a model supports Ollama's `think` chat option, decided from
   * `/api/show`'s `capabilities` array and cached per model name for the life
   * of the process. Any failure (network, non-OK, missing/empty capabilities)
   * is treated as "not supported": checking never fails a chat.
   */
  private async supportsThinking(model: string): Promise<boolean> {
    const cached = this.thinkingSupport.get(model);
    if (cached !== undefined) {
      return cached;
    }
    let supported = false;
    try {
      const info = await this.show(model);
      supported = Array.isArray(info.capabilities) && info.capabilities.includes("thinking");
    } catch {
      supported = false;
    }
    this.thinkingSupport.set(model, supported);
    return supported;
  }

  /**
   * Stream a chat completion. The /api/chat body is built explicitly as
   * {model, messages:[{role, content, ...}], keep_alive:-1, stream:true, think:true
   * when the model supports it, tools:[] when provided}: only model and messages come from the
   * caller, keep_alive:-1 keeps the resident model loaded indefinitely (FR4),
   * `think` is decided by the server from `/api/show` (I9) or from the request if provided.
   * When request.think is explicitly set (true or false), that value is always sent; when undefined,
   * think:true is sent if /api/show reports 'thinking' capability, otherwise no think key is sent.
   * `tools` is passed through when given and non-empty.
   * format, options, think, and keep_alive may be overridden per-request.
   */
  async *chat(
    request: OllamaChatRequest,
    signal?: AbortSignal,
    tools?: OllamaTool[]
  ): AsyncGenerator<OllamaChatResponse & { toolCalls?: OllamaToolCall[] }, void, unknown> {
    const autoDetectedThink = await this.supportsThinking(request.model);
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.tool_calls !== undefined) {
          msg.tool_calls = m.tool_calls;
        }
        if (m.tool_name !== undefined) {
          msg.tool_name = m.tool_name;
        }
        return msg;
      }),
      keep_alive: request.keep_alive !== undefined ? request.keep_alive : -1,
      stream: true,
      ...(request.think !== undefined ? { think: request.think } : autoDetectedThink ? { think: true } : {}),
    };
    // Add format if provided
    if (request.format !== undefined) {
      body.format = request.format;
    }
    // Add options if provided
    if (request.options !== undefined) {
      body.options = request.options;
    }
    // Only include tools if provided and non-empty
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama /api/chat failed: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("No response body from Ollama");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const json = JSON.parse(line) as OllamaChatResponse;
              // Expose tool_calls from the message as toolCalls on the yielded object
              const result: OllamaChatResponse & { toolCalls?: OllamaToolCall[] } = json;
              if (json.message?.tool_calls) {
                result.toolCalls = json.message.tool_calls;
              }
              yield result;
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }

      // Process any remaining data
      if (buffer.trim()) {
        try {
          const json = JSON.parse(buffer) as OllamaChatResponse;
          // Expose tool_calls from the message as toolCalls on the yielded object
          const result: OllamaChatResponse & { toolCalls?: OllamaToolCall[] } = json;
          if (json.message?.tool_calls) {
            result.toolCalls = json.message.tool_calls;
          }
          yield result;
        } catch {
          // Skip malformed JSON
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
