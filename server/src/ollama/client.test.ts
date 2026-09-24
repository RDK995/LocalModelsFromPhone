import { describe, it, expect } from "bun:test";
import { OllamaClient } from "./client";

describe("OllamaClient", () => {
  it("should be instantiable with default URL", () => {
    const client = new OllamaClient();
    expect(client).toBeDefined();
  });

  it("should be instantiable with custom URL", () => {
    const client = new OllamaClient("http://localhost:11434");
    expect(client).toBeDefined();
  });

  it("should have tags method", () => {
    const client = new OllamaClient();
    expect(typeof client.tags).toBe("function");
  });

  it("should have ps method", () => {
    const client = new OllamaClient();
    expect(typeof client.ps).toBe("function");
  });

  it("should have generate method", () => {
    const client = new OllamaClient();
    expect(typeof client.generate).toBe("function");
  });

  it("should have chat method", () => {
    const client = new OllamaClient();
    expect(typeof client.chat).toBe("function");
  });

  it("chat should be an async generator", async () => {
    const client = new OllamaClient();
    const chatGenerator = client.chat({
      model: "test",
      messages: [{ role: "user", content: "test" }],
    });
    expect(Symbol.asyncIterator in Object(chatGenerator)).toBe(true);
  });
});
