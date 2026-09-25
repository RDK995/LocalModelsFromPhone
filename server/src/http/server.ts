/**
 * HTTP Server with bearer token authentication
 * Serves on 127.0.0.1:<port> (default 7789)
 */

import { timingSafeEqual } from "node:crypto";
import {
  GenerationManager,
  type GenerationEvent,
  type OllamaChatClient,
} from "../generations/manager";
import type {
  OllamaTagsResponse,
  OllamaPsResponse,
} from "../ollama/client";
import {
  ModelManager,
  OllamaDownError,
  UnknownModelError,
  OperationInProgressError,
} from "../models/manager";
import type {
  ErrorResponse,
  ChatRequest,
} from "@shared/api";

const LISTEN_HOST = "127.0.0.1";
const DEFAULT_PORT = 7789;

/**
 * The subset of OllamaClient that the HTTP layer depends on directly (beyond
 * what GenerationManager needs). Declared as an interface so tests can inject
 * a fake without satisfying OllamaClient's private fields.
 */
export interface OllamaStateClient extends OllamaChatClient {
  tags(): Promise<OllamaTagsResponse>;
  ps(): Promise<OllamaPsResponse>;
  load(name: string): Promise<void>;
  unload(name: string): Promise<void>;
}

export interface CreateServerOptions {
  ollama: OllamaStateClient;
  manager?: GenerationManager;
  models?: ModelManager;
  port?: number;
}

interface AuthContext {
  token?: string;
}

interface RouteHandler {
  (
    req: Request,
    params: Record<string, string>,
    auth: AuthContext
  ): Response | Promise<Response>;
}

interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

/**
 * Parse bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | null | undefined): string | undefined {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return undefined;
  }
  return authHeader.slice(7); // Remove "Bearer " prefix
}

/**
 * Check if token is valid (loaded from config on startup)
 */
let validToken: string = "";

export function setValidToken(token: string): void {
  validToken = token;
}

export function getValidToken(): string {
  return validToken;
}

/**
 * Constant-time token comparison: a length check, then timingSafeEqual on
 * equal-length buffers.
 */
function tokensMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Verify bearer token
 */
function verifyAuth(req: Request): AuthContext | null {
  const authHeader = req.headers.get("Authorization");
  const token = extractBearerToken(authHeader);

  if (!token || !validToken || !tokensMatch(token, validToken)) {
    return null;
  }

  return { token };
}

/**
 * Create 401 Unauthorized response
 */
function unauthorized(): Response {
  const errorResponse: ErrorResponse = {
    error: "unauthorized",
    message: "Invalid or missing bearer token",
  };
  return new Response(JSON.stringify(errorResponse), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/**
 * Create 200 JSON response
 */
function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/**
 * Create error response
 */
function errorResponse(code: string, message: string, status: number, extra?: Record<string, unknown>): Response {
  const errorBody: ErrorResponse & Record<string, unknown> = {
    error: code,
    message,
    ...extra,
  };
  return new Response(JSON.stringify(errorBody), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/**
 * Simple path pattern matcher with parameter extraction
 * Patterns like /v1/generations/{id}/events -> { id: "..." }
 */
function matchPath(
  pattern: string,
  pathname: string
): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathnameParts = pathname.split("/");

  if (patternParts.length !== pathnameParts.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith("{") && part.endsWith("}")) {
      const paramName = part.slice(1, -1);
      params[paramName] = pathnameParts[i];
    } else if (part !== pathnameParts[i]) {
      return null;
    }
  }

  return params;
}

/**
 * Format a single SSE event: "id: ...\nevent: ...\ndata: ...\n\n"
 */
function formatSSE(id: string, event: string, data: string): string {
  return `id: ${id}\nevent: ${event}\ndata: ${data}\n\n`;
}

function encodeSSE(id: string, event: string, data: string): Uint8Array {
  return new TextEncoder().encode(formatSSE(id, event, data));
}

/**
 * Validate a /v1/chat body and copy out only the contract fields
 * `{model, messages:[{role:"user"|"assistant", content:string}]}`.
 * Returns an error message for an invalid body.
 */
function parseChatRequest(body: unknown): ChatRequest | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "Request body must be a JSON object";
  }
  const { model, messages } = body as Record<string, unknown>;
  if (typeof model !== "string" || model.length === 0) {
    return "model must be a non-empty string";
  }
  if (!Array.isArray(messages)) {
    return "messages must be an array";
  }
  const parsed: ChatRequest["messages"] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      return `messages[${i}] must be an object`;
    }
    const { role, content } = message as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") {
      return `messages[${i}].role must be "user" or "assistant"`;
    }
    if (typeof content !== "string") {
      return `messages[${i}].content must be a string`;
    }
    parsed.push({ role, content });
  }
  return { model, messages: parsed };
}

/**
 * Validate a /v1/models/load body: `{name, confirm?}`. Only `name` matters
 * here (the confirmation rule is M2c: `confirm` is accepted and ignored).
 * Returns `{name}`, or an error message for an invalid body.
 */
function parseLoadRequest(body: unknown): { name: string } | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "Request body must be a JSON object";
  }
  const { name } = body as Record<string, unknown>;
  if (typeof name !== "string" || name.length === 0) {
    return "name must be a non-empty string";
  }
  return { name };
}

/**
 * Stream a generation's events (from `fromSeq`, then live) as SSE. The
 * response is one subscriber: if the client goes away, only the subscription
 * is dropped; the generation carries on.
 */
function sseResponse(
  manager: GenerationManager,
  genId: string,
  fromSeq: number,
  extraHeaders: Record<string, string> = {}
): Response {
  const events: AsyncGenerator<GenerationEvent, void, unknown> = manager.subscribe(genId, fromSeq);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Bun holds the response headers until the first body chunk. An SSE
      // comment (ignored by SSE parsers) sends them now, so the client gets
      // x-generation-id before the first token or the next live event.
      controller.enqueue(new TextEncoder().encode(": connected\n\n"));
    },
    async pull(controller) {
      const { value, done } = await events.next();
      try {
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encodeSSE(`${genId}-${value.seq}`, value.type, value.data));
      } catch {
        // The client went away while we waited; nothing to deliver to.
      }
    },
    cancel() {
      // Drop this subscription only. Not awaited: the subscriber may be
      // waiting for the next event and finishes on its own when it arrives.
      events.return(undefined).catch(() => {});
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      ...extraHeaders,
    },
  });
}

/**
 * Does this generation id refer to something the manager knows about (active
 * or with a not-yet-expired event log)?
 */
function knownGeneration(manager: GenerationManager, genId: string): boolean {
  return manager.isGenerationActive(genId) || manager.hasEventLog(genId);
}

/**
 * Parse the resume point from a Last-Event-ID header of the form
 * "<generationId>-<seq>". Returns the seq to resume *from* (i.e. one past the
 * last seq the client already has), or 0 if absent/unparseable.
 */
function parseResumeSeq(lastEventId: string | null): number {
  if (!lastEventId) {
    return 0;
  }
  const match = lastEventId.match(/-(\d+)$/);
  if (!match) {
    return 0;
  }
  return Number(match[1]) + 1;
}

/**
 * Create the HTTP server
 */
export function createServer({
  ollama,
  manager,
  models,
  port = DEFAULT_PORT,
}: CreateServerOptions): ReturnType<typeof Bun.serve> {
  const genManager = manager ?? new GenerationManager(ollama);
  const modelManager = models ?? new ModelManager(ollama, genManager);

  const routes: Route[] = [
    {
      method: "GET",
      path: "/v1/state",
      handler: async () => {
        try {
          const state = await modelManager.state();
          return jsonResponse(state);
        } catch (error) {
          if (error instanceof OllamaDownError) {
            return errorResponse("ollama_down", error.message, 503);
          }
          throw error;
        }
      },
    },
    {
      method: "POST",
      path: "/v1/models/load",
      handler: async (req) => {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return errorResponse("bad_request", "Malformed JSON body", 400);
        }
        const parsed = parseLoadRequest(raw);
        if (typeof parsed === "string") {
          return errorResponse("bad_request", parsed, 400);
        }

        try {
          const operation = await modelManager.load(parsed.name);
          return jsonResponse({ operation }, 202);
        } catch (error) {
          if (error instanceof UnknownModelError) {
            return errorResponse("unknown_model", error.message, 404);
          }
          if (error instanceof OperationInProgressError) {
            return errorResponse("operation_in_progress", error.message, 409);
          }
          if (error instanceof OllamaDownError) {
            return errorResponse("ollama_down", error.message, 503);
          }
          throw error;
        }
      },
    },
    {
      method: "POST",
      path: "/v1/models/unload",
      handler: async () => {
        // Body is optional (only `confirm`, accepted and ignored - M2c).
        try {
          const operation = await modelManager.unload();
          return jsonResponse({ operation }, 202);
        } catch (error) {
          if (error instanceof OperationInProgressError) {
            return errorResponse("operation_in_progress", error.message, 409);
          }
          throw error;
        }
      },
    },
    {
      method: "POST",
      path: "/v1/chat",
      handler: async (req) => {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return errorResponse("bad_request", "Malformed JSON body", 400);
        }
        const body = parseChatRequest(raw);
        if (typeof body === "string") {
          return errorResponse("bad_request", body, 400);
        }

        if (modelManager.isBusy()) {
          return errorResponse(
            "operation_in_progress",
            "A model load/unload operation is in progress",
            409
          );
        }

        const alreadyActive = genManager.getActiveGenId();
        if (alreadyActive !== null) {
          return errorResponse(
            "generation_in_flight",
            "A generation is already in progress",
            409,
            { generation_id: alreadyActive }
          );
        }

        let residentNames: string[];
        try {
          residentNames = (await ollama.ps()).models.map((m) => m.name);
        } catch {
          return errorResponse("ollama_down", "Unable to reach Ollama", 503);
        }
        if (!residentNames.includes(body.model)) {
          return errorResponse(
            "model_not_resident",
            `Model "${body.model}" is not loaded; load it first`,
            409
          );
        }

        const genId = crypto.randomUUID();
        try {
          genManager.startGeneration(genId, body);
        } catch {
          // Lost the race between the check above and starting.
          const stillActive = genManager.getActiveGenId();
          return errorResponse(
            "generation_in_flight",
            "A generation is already in progress",
            409,
            { generation_id: stillActive }
          );
        }

        return sseResponse(genManager, genId, 0, { "x-generation-id": genId });
      },
    },
    {
      method: "GET",
      path: "/v1/generations/{id}/events",
      handler: async (req, params) => {
        const genId = params.id;
        if (!knownGeneration(genManager, genId)) {
          return errorResponse("unknown_generation", "No such generation", 404);
        }

        const fromSeq = parseResumeSeq(req.headers.get("Last-Event-ID"));
        return sseResponse(genManager, genId, fromSeq);
      },
    },
    {
      method: "POST",
      path: "/v1/generations/{id}/cancel",
      handler: async (req, params) => {
        const genId = params.id;
        if (!knownGeneration(genManager, genId)) {
          return errorResponse("unknown_generation", "No such generation", 404);
        }

        const cancelled = genManager.cancelGeneration(genId);
        return jsonResponse(
          { status: cancelled ? "cancelled" : "already_complete" },
          200
        );
      },
    },
  ];

  return Bun.serve({
    hostname: LISTEN_HOST,
    port,
    idleTimeout: 255,
    fetch: async (req: Request) => {
      const url = new URL(req.url);
      const pathname = url.pathname;
      const method = req.method;

      // Verify authentication first (before routing)
      const auth = verifyAuth(req);
      if (!auth) {
        return unauthorized();
      }

      // Find matching route
      let matchedRoute: Route | undefined;
      let params: Record<string, string> = {};

      for (const route of routes) {
        if (route.method === method) {
          const matched = matchPath(route.path, pathname);
          if (matched !== null) {
            matchedRoute = route;
            params = matched;
            break;
          }
        }
      }

      if (!matchedRoute) {
        return new Response("Not Found", { status: 404 });
      }

      try {
        const response = await matchedRoute.handler(req, params, auth);
        return response;
      } catch (error) {
        console.error("Route error:", error);
        return errorResponse(
          "internal_error",
          "An internal error occurred",
          500
        );
      }
    },
  });
}
