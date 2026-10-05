/** Error replies with no answer text show a plain line (M19f-AC3, FR45). */

import { describe, it, expect } from "bun:test";
import { ServerError, UnreachableError } from "@/api/client";
import type { Message } from "@/store/conversationStore";
import { buildChatItems, stepLabel } from "./chatItems";
import { errorLineFor, LOST_CONNECTION_LINE, RESUME_EXHAUSTED_MESSAGE } from "./errorReply";

const base = { id: "a1", role: "assistant" as const };

describe("LOST_CONNECTION_LINE and errorLineFor", () => {
  it("has the exact wording", () => {
    expect(LOST_CONNECTION_LINE).toBe("Lost connection to the Mac before the reply arrived");
  });
  it("maps lost-connection errors to the line", () => {
    expect(errorLineFor(new Error(RESUME_EXHAUSTED_MESSAGE))).toBe(LOST_CONNECTION_LINE);
    expect(errorLineFor(new UnreachableError())).toBe(LOST_CONNECTION_LINE);
    expect(errorLineFor(new TypeError("Network request failed"))).toBe(LOST_CONNECTION_LINE);
  });
  it("describes other errors", () => {
    expect(errorLineFor(new ServerError("boom", "boom"))).not.toBe(LOST_CONNECTION_LINE);
    expect(errorLineFor(new Error("model_error: bad"))).toBe("model_error: bad");
  });
});

describe("buildChatItems: errorLine", () => {
  it("falls back to the lost-connection line for an error reply stored without error_message", () => {
    const m: Message = { ...base, content: "", status: "error" };
    expect(buildChatItems([m], null)[0].errorLine).toBe(LOST_CONNECTION_LINE);
  });
  it("uses the stored error_message, also for whitespace-only content", () => {
    const m: Message = { ...base, content: "  \n", status: "error", error_message: "Password wrong or changed" };
    expect(buildChatItems([m], null)[0].errorLine).toBe("Password wrong or changed");
  });
  it("gives no errorLine to an error reply with text, or a complete reply", () => {
    const withText: Message = { ...base, content: "partial", status: "error" };
    const complete: Message = { ...base, id: "a2", content: "", status: "complete" };
    const items = buildChatItems([withText, complete], null);
    expect(items[0].errorLine).toBeUndefined();
    expect(items[1].errorLine).toBeUndefined();
  });
});

describe("stepLabel: model steps", () => {
  const step = (status: "started" | "done" | "failed", detail?: string) => ({
    step_id: "m1",
    kind: "model" as const,
    status,
    ...(detail ? { detail } : {}),
  });
  it("shows the detail, with (failed) when failed, and falls back to Thinking", () => {
    expect(stepLabel(step("started", "Choosing pages"))).toBe("Choosing pages");
    expect(stepLabel(step("done", "Taking notes: example.com"))).toBe("Taking notes: example.com");
    expect(stepLabel(step("failed", "Checking for gaps"))).toBe("Checking for gaps (failed)");
    expect(stepLabel(step("started"))).toBe("Thinking");
  });
});
