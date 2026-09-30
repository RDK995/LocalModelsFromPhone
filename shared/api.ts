/**
 * Shared API types between server and mobile app
 */

export interface Model {
  name: string;
  size_bytes: number;
  tools: boolean;
}

export interface ResidentModel {
  name: string;
  loaded_by_server: boolean;
}

export type OperationKind = "idle" | "loading" | "unloading";

export interface Operation {
  kind: OperationKind;
  model?: string;
  error?: string;
  /**
   * Set alongside `error` for a failed LOAD (never set for an unload
   * failure, or by a server that predates this field): the plain-language
   * mapping (FR16, mobile/src/api/errorMessages.ts) uses this instead of
   * parsing `error`'s free text.
   */
  error_code?: "ollama_down" | "unknown_model" | "load_failed";
}

export interface Generation {
  id: string;
  model: string;
}

export interface StateResponse {
  models: Model[];
  resident: ResidentModel | null;
  operation: Operation;
  generation: Generation | null;
}

export interface LoadRequest {
  name: string;
  confirm?: boolean;
}

export interface UnloadRequest {
  confirm?: boolean;
}

export interface ChatRequest {
  model: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  web?: boolean;
}

export interface OperationResponse {
  operation: Operation;
}

export type SSEEventType = "thinking" | "content" | "done" | "error";

export interface SSEEvent {
  id: string;
  event: SSEEventType;
  data: string;
}

export interface ThinkingEvent {
  text: string;
}

export interface ContentEvent {
  text: string;
}

export interface DoneEvent {
  status: "complete" | "cancelled";
  model: string;
  eval_count: number;
  tokens_per_second: number;
}

export interface ErrorEvent {
  code: string;
  message: string;
}

export interface ConfirmationRequiredError {
  reasons: Array<"reply_in_progress" | "not_loaded_by_server">;
}

export interface ErrorResponse {
  error: string;
  message?: string;
}
