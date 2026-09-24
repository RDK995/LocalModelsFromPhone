/**
 * Ollama client - typed wrapper around Ollama's HTTP API
 * Ollama is running at 127.0.0.1:11434
 */

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
}

export interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  keep_alive?: number;
  stream?: boolean;
  options?: {
    num_ctx?: number;
  };
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: "assistant";
    content: string;
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

export class OllamaClient {
  private baseUrl: string;

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
      throw new Error(`Ollama /api/generate failed: ${response.status}`);
    }

    // Consume the response
    await response.text();
  }

  /**
   * Stream a chat completion - returns a ReadableStream
   */
  async *chat(
    request: OllamaChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<OllamaChatResponse, void, unknown> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...request,
        stream: true,
      }),
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
              const json = JSON.parse(line);
              yield json;
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }

      // Process any remaining data
      if (buffer.trim()) {
        try {
          const json = JSON.parse(buffer);
          yield json;
        } catch {
          // Skip malformed JSON
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
