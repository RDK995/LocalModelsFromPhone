/**
 * Model manager (C5, I6) - reports installed and resident Ollama models.
 *
 * Load/unload (FR3-FR6) are implemented in a later milestone; this milestone
 * only covers `state()` (FR1, FR2), replacing the inline /v1/state logic that
 * used to live in the HTTP layer.
 */

import type { OllamaTagsResponse, OllamaPsResponse } from "../ollama/client";
import type { StateResponse, Generation } from "@shared/api";

/**
 * The subset of OllamaClient that ModelManager depends on. Declared as an
 * interface (rather than importing the concrete class) so tests can inject a
 * fake without satisfying OllamaClient's private fields.
 */
export interface ModelManagerOllama {
  tags(): Promise<OllamaTagsResponse>;
  ps(): Promise<OllamaPsResponse>;
}

/**
 * The subset of GenerationManager that ModelManager depends on, for the
 * `generation` field of the state response.
 */
export interface ModelManagerGenerations {
  getActiveGeneration(): Generation | null;
}

/** Ollama's /api/tags or /api/ps was unreachable or errored. */
export class OllamaDownError extends Error {
  constructor(message: string = "Unable to reach Ollama") {
    super(message);
    this.name = "OllamaDownError";
  }
}

export class ModelManager {
  constructor(
    private ollama: ModelManagerOllama,
    private generations: ModelManagerGenerations
  ) {}

  /**
   * Every model installed in Ollama (from /api/tags, in order, real name and
   * size), the true resident model from /api/ps (or null when nothing is
   * loaded, regardless of who loaded it), and the active generation.
   * Load/unload are not implemented yet, so `operation` is always idle.
   */
  async state(): Promise<StateResponse> {
    let tags: OllamaTagsResponse;
    let ps: OllamaPsResponse;
    try {
      tags = await this.ollama.tags();
      ps = await this.ollama.ps();
    } catch {
      throw new OllamaDownError();
    }

    const models = tags.models.map((m) => ({ name: m.name, size_bytes: m.size }));
    const resident =
      ps.models.length > 0 ? { name: ps.models[0].name, loaded_by_server: false } : null;

    return {
      models,
      resident,
      operation: { kind: "idle" },
      generation: this.generations.getActiveGeneration(),
    };
  }
}
