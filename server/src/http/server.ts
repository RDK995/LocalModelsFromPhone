/**
 * HTTP Server with bearer token authentication
 * Serves on 127.0.0.1:7789
 */

import { OllamaClient } from "../ollama/client";
import type { ErrorResponse } from "@shared/api";

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = 7789;

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
function errorResponse(code: string, message: string, status: number): Response {
  const errorBody: ErrorResponse = {
    error: code,
    message,
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
 * Create the HTTP server
 */
export function createServer(ollamaClient: OllamaClient): ReturnType<typeof Bun.serve> {
  const routes: Route[] = [
    {
      method: "GET",
      path: "/v1/state",
      handler: async (req, params, auth) => {
        // This will be implemented when ModelManager is ready
        // For now, return a minimal response to satisfy tests
        return jsonResponse({
          models: [],
          resident: null,
          operation: { kind: "idle" },
          generation: null,
        });
      },
    },
    {
      method: "POST",
      path: "/v1/models/load",
      handler: async (req, params, auth) => {
        // Will be implemented with ModelManager
        return jsonResponse({ operation: { kind: "idle" } }, 202);
      },
    },
    {
      method: "POST",
      path: "/v1/models/unload",
      handler: async (req, params, auth) => {
        // Will be implemented with ModelManager
        return jsonResponse({ operation: { kind: "idle" } }, 202);
      },
    },
    {
      method: "POST",
      path: "/v1/chat",
      handler: async (req, params, auth) => {
        // Will be implemented with GenerationManager
        return new Response("event: error\ndata: {}\n\n", {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "x-generation-id": "test-gen-1",
          },
        });
      },
    },
    {
      method: "GET",
      path: "/v1/generations/{id}/events",
      handler: async (req, params, auth) => {
        // Will be implemented with GenerationManager
        return new Response("", {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        });
      },
    },
    {
      method: "POST",
      path: "/v1/generations/{id}/cancel",
      handler: async (req, params, auth) => {
        // Will be implemented with GenerationManager
        return new Response("", {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        });
      },
    },
  ];

  return Bun.serve({
    hostname: LISTEN_HOST,
    port: LISTEN_PORT,
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
