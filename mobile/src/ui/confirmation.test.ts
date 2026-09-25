/**
 * Behavioural tests for the busy-confirmation warning text (FR6): each
 * reason's wording, both reasons together, and the explicit best-guess
 * wording for `not_loaded_by_server`.
 */

import { describe, it, expect } from "bun:test";
import { buildConfirmationWarning } from "./confirmation";

describe("buildConfirmationWarning", () => {
  it("says a reply is still being written and continuing will stop it, for reply_in_progress", () => {
    const warning = buildConfirmationWarning(["reply_in_progress"], null);

    expect(warning.message).toMatch(/reply is still being (written|generated)/i);
    expect(warning.message).toMatch(/stop it/i);
    expect(warning.message).not.toMatch(/best guess/i);
  });

  it("names the resident model, says it may be in use by another program, and calls it a best guess, for not_loaded_by_server", () => {
    const warning = buildConfirmationWarning(
      ["not_loaded_by_server"],
      "llama3:70b"
    );

    expect(warning.message).toContain("llama3:70b");
    expect(warning.message).toMatch(/not loaded by this app/i);
    expect(warning.message).toMatch(/another program on the mac/i);
    expect(warning.message).toMatch(/best guess/i);
    expect(warning.message).toMatch(/ollama cannot tell whether/i);
  });

  it("falls back to a generic subject for not_loaded_by_server when the resident model name is not known", () => {
    const warning = buildConfirmationWarning(["not_loaded_by_server"], null);

    expect(warning.message).toMatch(/the loaded model/i);
    expect(warning.message).toMatch(/best guess/i);
  });

  it("includes both sentences when both reasons are given", () => {
    const warning = buildConfirmationWarning(
      ["reply_in_progress", "not_loaded_by_server"],
      "llama3:70b"
    );

    expect(warning.message).toMatch(/reply is still being (written|generated)/i);
    expect(warning.message).toMatch(/best guess/i);
    expect(warning.message).toContain("llama3:70b");
  });

  it("returns a non-empty title", () => {
    const warning = buildConfirmationWarning(["reply_in_progress"], null);

    expect(warning.title.length).toBeGreaterThan(0);
  });
});
