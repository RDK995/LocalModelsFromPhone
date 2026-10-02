/**
 * Behavioural tests for the plain-language error mapping (FR16): each of the
 * six failure modes must reach `describeError`/`describeOperationFailure` as
 * its own fixed sentence, and the six sentences must be pairwise distinct.
 */

import { describe, it, expect } from "bun:test";
import {
  UNREACHABLE_MESSAGE,
  OLLAMA_DOWN_MESSAGE,
  UNAUTHORIZED_MESSAGE,
  REPLY_IN_PROGRESS_MESSAGE,
  loadFailedMessage,
  notInstalledMessage,
  describeError,
  describeOperationFailure,
} from "./errorMessages";
import { ServerError, UnauthorizedError, UnreachableError } from "./client";
import type { Operation } from "@shared/api";

describe("describeError", () => {
  it("maps UnauthorizedError to the wrong-password sentence", () => {
    expect(describeError(new UnauthorizedError())).toBe(UNAUTHORIZED_MESSAGE);
  });

  it("maps UnreachableError to the can't-reach-the-Mac sentence", () => {
    expect(describeError(new UnreachableError())).toBe(UNREACHABLE_MESSAGE);
  });

  it("maps a ServerError('ollama_down') to the Ollama-not-running sentence", () => {
    expect(describeError(new ServerError("ollama_down"))).toBe(
      OLLAMA_DOWN_MESSAGE
    );
  });

  it("maps a ServerError('unknown_model') to the not-installed sentence, naming the model", () => {
    expect(describeError(new ServerError("unknown_model"), "llama3:70b")).toBe(
      "llama3:70b is no longer installed on the Mac. Pull down to refresh the list."
    );
  });

  it("maps a ServerError('unknown_model') with no model name to the generic not-installed sentence", () => {
    expect(describeError(new ServerError("unknown_model"))).toBe(
      "That model is no longer installed on the Mac. Pull down to refresh the list."
    );
  });

  it("maps a ServerError('generation_in_flight') to the reply-in-progress sentence", () => {
    expect(describeError(new ServerError("generation_in_flight"))).toBe(
      REPLY_IN_PROGRESS_MESSAGE
    );
  });

  it("maps a ServerError('load_failed') to the load-failed sentence, naming the model", () => {
    expect(describeError(new ServerError("load_failed"), "phi3:mini")).toBe(
      "Couldn't load phi3:mini. Ollama failed to start it."
    );
  });

  it("maps a ServerError('load_failed') with no model name to the generic load-failed sentence", () => {
    expect(describeError(new ServerError("load_failed"))).toBe(
      "Couldn't load the model. Ollama failed to start it."
    );
  });

  it("falls back to an unrecognized ServerError's own message", () => {
    expect(describeError(new ServerError("operation_in_progress", "Already busy"))).toBe(
      "Already busy"
    );
  });

  it("falls back to a plain Error's own message", () => {
    expect(describeError(new Error("something else broke"))).toBe(
      "something else broke"
    );
  });

  it("all six failure-mode messages are pairwise distinct", () => {
    const messages = [
      UNREACHABLE_MESSAGE,
      OLLAMA_DOWN_MESSAGE,
      UNAUTHORIZED_MESSAGE,
      loadFailedMessage("m"),
      notInstalledMessage("m"),
      REPLY_IN_PROGRESS_MESSAGE,
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe("describeOperationFailure", () => {
  const base: Operation = { kind: "idle" };

  it("returns null when the operation carries no error", () => {
    expect(describeOperationFailure(base)).toBeNull();
  });

  it("maps error_code ollama_down to the Ollama-not-running sentence", () => {
    const operation: Operation = {
      ...base,
      error: "Ollama unreachable",
      error_code: "ollama_down",
    };
    expect(describeOperationFailure(operation)).toBe(OLLAMA_DOWN_MESSAGE);
  });

  it("maps error_code unknown_model to the not-installed sentence, naming the model", () => {
    const operation: Operation = {
      ...base,
      model: "llama3:70b",
      error: "Model not found: llama3:70b",
      error_code: "unknown_model",
    };
    expect(describeOperationFailure(operation)).toBe(
      "llama3:70b is no longer installed on the Mac. Pull down to refresh the list."
    );
  });

  it("maps error_code load_failed to the load-failed sentence, naming the model", () => {
    const operation: Operation = {
      ...base,
      model: "phi3:mini",
      error: "Not enough memory to load phi3:mini",
      error_code: "load_failed",
    };
    expect(describeOperationFailure(operation)).toBe(
      "Couldn't load phi3:mini. Ollama failed to start it."
    );
  });

  it("falls back to the raw error string unchanged when error_code is absent (unload failures, older servers)", () => {
    const operation: Operation = {
      ...base,
      error: "Unload failed: some other failure",
    };
    expect(describeOperationFailure(operation)).toBe(
      "Unload failed: some other failure"
    );
  });
});

describe("describeError: deep research refusals (M18)", () => {
  it("uses the server's own message for deep_research_model_not_loaded", () => {
    expect(
      describeError(
        new ServerError("deep_research_model_not_loaded", "Load qwen3.5:35b-a3b to use deep research")
      )
    ).toBe("Load qwen3.5:35b-a3b to use deep research");
  });

  it("falls back to a plain sentence when the model refusal carries no message", () => {
    expect(describeError(new ServerError("deep_research_model_not_loaded"))).toBe(
      "Load the deep research model to use deep research"
    );
  });

  it("maps deep_research_needs_web to a plain sentence", () => {
    expect(describeError(new ServerError("deep_research_needs_web", "whatever"))).toBe(
      "Deep research needs web search to be on."
    );
  });
});
