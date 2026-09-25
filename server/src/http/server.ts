/**
 * HTTP Server with bearer token authentication
 * Serves on 127.0.0.1:<port> (default 7789)
 */

import { GenerationManager, type OllamaChatClient } from "../generations/manager";
import type {
  OllamaTagsResponse,
  OllamaPsResponse,
} from "../ollama/client";
import type {
  ErrorResponse,
  ChatRequest,
  StateResponse,
  Model,
  ResidentModel,
  SSEEvent,
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
}

export interface CreateServerOptions {
  ollama: OllamaStateClient;
  manager?: GenerationManager;
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
 * Verify bearer token
 */
function verifyAuth(req: Request): AuthContext | null {
  const authHeader = req.headers.get("Authorization");
  const token = extractBearerToken(authHeader);

  if (!token || token !== validToken) {
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
  port = DEFAULT_PORT,
}: CreateServerOptions): ReturnType<typeof Bun.serve> {
  const genManager = manager ?? new GenerationManager(ollama);

  const routes: Route[] = [
    {
      method: "GET",
      path: "/v1/state",
      handler: async () => {
        let models: Model[] = [];
        let resident: ResidentModel | null = null;

        try {
          const tags = await ollama.tags();
          models = tags.models.map((m) => ({ name: m.name, size_bytes: m.size }));

          const ps = await ollama.ps();
          if (ps.models.length > 0) {
            resident = { name: ps.models[0].name, loaded_by_server: false };
          }
        } catch {
          return errorResponse("ollama_down", "Unable to reach Ollama", 503);
        }

        const generation = genManager.getActiveGeneration();

        const state: StateResponse = {
          models,
          resident,
          operation: { kind: "idle" },
          generation,
        };
        return jsonResponse(state);
      },
    },
    {
      method: "POST",
      path: "/v1/models/load",
      handler: async () => {
        // Will be implemented with ModelManager (M2)
        return jsonResponse({ operation: { kind: "idle" } }, 202);
      },
    },
    {
      method: "POST",
      path: "/v1/models/unload",
      handler: async () => {
        // Will be implemented with ModelManager (M2)
        return jsonResponse({ operation: { kind: "idle" } }, 202);
      },
    },
    {
      method: "POST",
      path: "/v1/chat",
      handler: async (req) => {
        let body: ChatRequest;
        try {
          body = (await req.json()) as ChatRequest;
        } catch {
          return errorResponse("invalid_request", "Malformed JSON body", 400);
        }
        if (!body || typeof body.model !== "string" || !Array.isArray(body.messages)) {
          return errorResponse(
            "invalid_request",
            "Request body must include model and messages",
            400
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

        const genId = crypto.randomUUID();
        let generator: AsyncGenerator<SSEEvent, void, unknown>;
        try {
          generator = genManager.startGeneration(genId, body);
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

        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { value, done } = await generator.next();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(encodeSSE(value.id, value.event, value.data));
          },
          async cancel() {
            genManager.cancelGeneration(genId);
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "x-generation-id": genId,
          },
        });
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
        const events = genManager.getEventLog(genId, fromSeq);

        const body = events
          .map((e) => formatSSE(`${genId}-${e.seq}`, e.type, e.data))
          .join("");

        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
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
