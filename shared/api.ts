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
  deep_research?: boolean;
}

export interface OperationResponse {
  operation: Operation;
}

export type SSEEventType = "thinking" | "content" | "done" | "error" | "step" | "sources";

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
  /** FR36: present on a deep research run's done event (status of the research, elapsed vs budget). */
  research?: {
    status: "complete" | "partial" | "failed";
    elapsed_ms: number;
    budget_ms: number;
  };
}

export interface StepEventData {
  step_id: string;
  kind: "search" | "read" | "continue" | "answer_now" | "plan" | "write";
  status: "started" | "done" | "failed" | "unavailable";
  query?: string;
  url?: string;
  detail?: string;
  /** FR36: on deep research steps, time since the run started and the run's budget. */
  elapsed_ms?: number;
  budget_ms?: number;
}

export interface SourcesEvent {
  items: Array<{ title: string; url: string; n?: number }>;
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
