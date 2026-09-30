/**
 * Tests for the web search switch state function, determining when the switch
 * is enabled and what explanation (if any) should be shown.
 */

import { describe, it, expect } from "bun:test";
import { webSwitchState } from "./webSwitch";
import type { Model, ResidentModel } from "@shared/api";

describe("webSwitchState", () => {
  it("is disabled with explanation when resident is null", () => {
    const models: Model[] = [
      { name: "llama2", size_bytes: 1000, tools: true },
    ];
    const result = webSwitchState(models, null);

    expect(result.enabled).toBe(false);
    expect(result.explanation).toBe("Load a model to use web search.");
  });

  it("is disabled with explanation when resident is undefined", () => {
    const models: Model[] = [
      { name: "llama2", size_bytes: 1000, tools: true },
    ];
    const result = webSwitchState(models, undefined);

    expect(result.enabled).toBe(false);
    expect(result.explanation).toBe("Load a model to use web search.");
  });

  it("is enabled with no explanation when resident model has tools", () => {
    const models: Model[] = [
      { name: "llama2", size_bytes: 1000, tools: true },
    ];
    const resident: ResidentModel = { name: "llama2", loaded_by_server: true };
    const result = webSwitchState(models, resident);

    expect(result.enabled).toBe(true);
    expect(result.explanation).toBeNull();
  });

  it("is disabled with explanation when resident model lacks tools", () => {
    const models: Model[] = [
      { name: "llama2", size_bytes: 1000, tools: false },
    ];
    const resident: ResidentModel = { name: "llama2", loaded_by_server: true };
    const result = webSwitchState(models, resident);

    expect(result.enabled).toBe(false);
    expect(result.explanation).toBe(
      "llama2 can't use web search (it has no tools support)."
    );
  });

  it("is disabled with explanation when resident not found in models", () => {
    const models: Model[] = [
      { name: "other-model", size_bytes: 1000, tools: true },
    ];
    const resident: ResidentModel = {
      name: "llama2",
      loaded_by_server: true,
    };
    const result = webSwitchState(models, resident);

    expect(result.enabled).toBe(false);
    expect(result.explanation).toBe(
      "Can't tell whether llama2 supports web search."
    );
  });

  it("is disabled with explanation when models is null and resident set", () => {
    const resident: ResidentModel = {
      name: "llama2",
      loaded_by_server: true,
    };
    const result = webSwitchState(null, resident);

    expect(result.enabled).toBe(false);
    expect(result.explanation).toBe(
      "Can't tell whether llama2 supports web search."
    );
  });

  it("is disabled with explanation when models is undefined and resident set", () => {
    const resident: ResidentModel = {
      name: "llama2",
      loaded_by_server: true,
    };
    const result = webSwitchState(undefined, resident);

    expect(result.enabled).toBe(false);
    expect(result.explanation).toBe(
      "Can't tell whether llama2 supports web search."
    );
  });

  it("handles multiple models in the list", () => {
    const models: Model[] = [
      { name: "llama2", size_bytes: 1000, tools: false },
      { name: "mistral", size_bytes: 2000, tools: true },
      { name: "neural-chat", size_bytes: 1500, tools: true },
    ];
    const resident: ResidentModel = {
      name: "mistral",
      loaded_by_server: true,
    };
    const result = webSwitchState(models, resident);

    expect(result.enabled).toBe(true);
    expect(result.explanation).toBeNull();
  });

  it("matches resident by name exactly", () => {
    const models: Model[] = [
      { name: "llama", size_bytes: 1000, tools: true },
      { name: "llama2", size_bytes: 1000, tools: false },
    ];
    const resident: ResidentModel = {
      name: "llama2",
      loaded_by_server: true,
    };
    const result = webSwitchState(models, resident);

    expect(result.enabled).toBe(false);
    expect(result.explanation).toBe(
      "llama2 can't use web search (it has no tools support)."
    );
  });

  it("handles model name with special characters in explanation", () => {
    const models: Model[] = [
      { name: "neural-chat-7b", size_bytes: 1000, tools: false },
    ];
    const resident: ResidentModel = {
      name: "neural-chat-7b",
      loaded_by_server: true,
    };
    const result = webSwitchState(models, resident);

    expect(result.enabled).toBe(false);
    expect(result.explanation).toBe(
      "neural-chat-7b can't use web search (it has no tools support)."
    );
  });
});
