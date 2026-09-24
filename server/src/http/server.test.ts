import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createServer, setValidToken, getValidToken } from "./server";
import { OllamaClient } from "../ollama/client";

describe("HTTP Server with Bearer Auth", () => {
  it("should allow setting and getting valid token", () => {
    const testToken = "test-token-12345";
    setValidToken(testToken);
    expect(getValidToken()).toBe(testToken);
  });

  it("should be able to create a server instance", () => {
    const client = new OllamaClient();
    setValidToken("test-token");
    const server = createServer(client);
    expect(server).toBeDefined();
    server.stop();
  });

  it("should reject requests without bearer token", async () => {
    const client = new OllamaClient();
    const testToken = "secure-token-123";
    setValidToken(testToken);
    const server = createServer(client);

    try {
      const response = await fetch("http://127.0.0.1:7789/v1/state", {
        method: "GET",
      });

      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    } finally {
      server.stop();
    }
  });

  it("should reject requests with invalid bearer token", async () => {
    const client = new OllamaClient();
    const testToken = "valid-token";
    setValidToken(testToken);
    const server = createServer(client);

    try {
      const response = await fetch("http://127.0.0.1:7789/v1/state", {
        method: "GET",
        headers: {
          Authorization: "Bearer invalid-token",
        },
      });

      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    } finally {
      server.stop();
    }
  });

  it("should accept requests with valid bearer token", async () => {
    const client = new OllamaClient();
    const testToken = "valid-test-token";
    setValidToken(testToken);
    const server = createServer(client);

    try {
      const response = await fetch("http://127.0.0.1:7789/v1/state", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("models");
      expect(body).toHaveProperty("resident");
      expect(body).toHaveProperty("operation");
      expect(body).toHaveProperty("generation");
    } finally {
      server.stop();
    }
  });

  it("should accept requests with Bearer token prefix variations", async () => {
    const client = new OllamaClient();
    const testToken = "token-with-case";
    setValidToken(testToken);
    const server = createServer(client);

    try {
      // Note: The Authorization header parsing is case-insensitive in HTTP spec,
      // but we require exactly "Bearer " prefix with space
      const response = await fetch("http://127.0.0.1:7789/v1/state", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      expect(response.status).toBe(200);
    } finally {
      server.stop();
    }
  });

  it("should return 404 for non-existent routes", async () => {
    const client = new OllamaClient();
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer(client);

    try {
      const response = await fetch("http://127.0.0.1:7789/v1/nonexistent", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      expect(response.status).toBe(404);
    } finally {
      server.stop();
    }
  });

  it("should enforce auth before routing 404", async () => {
    const client = new OllamaClient();
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer(client);

    try {
      const response = await fetch("http://127.0.0.1:7789/v1/nonexistent", {
        method: "GET",
        headers: {
          Authorization: "Bearer wrong-token",
        },
      });

      // Should be 401 (auth failure) before 404 (route not found)
      expect(response.status).toBe(401);
    } finally {
      server.stop();
    }
  });

  it("should support /v1/models/load endpoint", async () => {
    const client = new OllamaClient();
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer(client);

    try {
      const response = await fetch("http://127.0.0.1:7789/v1/models/load", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testToken}`,
        },
        body: JSON.stringify({ name: "test-model" }),
      });

      expect(response.status).toBe(202);
    } finally {
      server.stop();
    }
  });

  it("should support /v1/models/unload endpoint", async () => {
    const client = new OllamaClient();
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer(client);

    try {
      const response = await fetch("http://127.0.0.1:7789/v1/models/unload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testToken}`,
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(202);
    } finally {
      server.stop();
    }
  });

  it("should support /v1/chat endpoint", async () => {
    const client = new OllamaClient();
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer(client);

    try {
      const response = await fetch("http://127.0.0.1:7789/v1/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testToken}`,
        },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.has("x-generation-id")).toBe(true);
    } finally {
      server.stop();
    }
  });

  it("should require auth on all endpoints", async () => {
    const client = new OllamaClient();
    const testToken = "test-token";
    setValidToken(testToken);
    const server = createServer(client);

    try {
      const endpoints = [
        { method: "GET", path: "/v1/state" },
        { method: "POST", path: "/v1/models/load" },
        { method: "POST", path: "/v1/models/unload" },
        { method: "POST", path: "/v1/chat" },
        { method: "GET", path: "/v1/generations/test-id/events" },
        { method: "POST", path: "/v1/generations/test-id/cancel" },
      ];

      for (const endpoint of endpoints) {
        const response = await fetch(
          `http://127.0.0.1:7789${endpoint.path}`,
          {
            method: endpoint.method,
            headers: {
              "Content-Type": "application/json",
              // No Authorization header
            },
          }
        );

        expect(response.status, `Endpoint ${endpoint.method} ${endpoint.path} did not return 401`).toBe(401);
      }
    } finally {
      server.stop();
    }
  });
});
