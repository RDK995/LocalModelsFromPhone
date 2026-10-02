/**
 * Behavioural tests for the pure Load/Unload polling helper behind the
 * Models screen (src/app/models.tsx): starting the operation, then polling
 * `GET /v1/state` until it goes idle, with a fake `sleep` so the poll loop
 * runs without waiting in real time.
 */

import { describe, it, expect } from "bun:test";
import { runModelAction } from "./modelActions";
import { ConfirmationRequiredError } from "@/api/client";
import type { StateResponse } from "@shared/api";

function stateWith(operation: StateResponse["operation"]): StateResponse {
  return {
    models: [{ name: "llama3:70b", size_bytes: 39_000_000_000, tools: false }],
    resident: null,
    operation,
    generation: null,
    deep_research_model: "qwen3.5:35b-a3b",
  };
}

/** A fake `sleep` that resolves immediately but records every call. */
function fakeSleep(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return {
    sleep: async (ms: number) => {
      calls.push(ms);
    },
    calls,
  };
}

describe("runModelAction", () => {
  it("calls start, then polls getState until idle, reporting each polled state", async () => {
    const states = [
      stateWith({ kind: "loading", model: "llama3:70b" }),
      stateWith({ kind: "loading", model: "llama3:70b" }),
      stateWith({ kind: "idle" }),
    ];
    let callIndex = 0;
    const polled: StateResponse[] = [];
    const startCalls: number[] = [];
    const { sleep, calls: sleepCalls } = fakeSleep();

    const result = await runModelAction({
      start: async () => {
        startCalls.push(1);
      },
      getState: async () => states[callIndex++],
      onPoll: (state) => polled.push(state),
      sleep,
      intervalMs: 50,
      maxWaitMs: 1000,
    });

    expect(startCalls).toHaveLength(1);
    expect(polled.map((s) => s.operation.kind)).toEqual([
      "loading",
      "loading",
      "idle",
    ]);
    if ("cancelled" in result) {
      throw new Error("expected a StateResponse, not a cancelled outcome");
    }
    expect(result.operation.kind).toBe("idle");
    expect(sleepCalls).toEqual([50, 50]);
  });

  it("returns the final idle state including a failure reason on a failed load", async () => {
    const finalState = stateWith({
      kind: "idle",
      model: "llama3:70b",
      error: "Insufficient memory to load llama3:70b",
    });
    const states = [stateWith({ kind: "loading", model: "llama3:70b" }), finalState];
    let callIndex = 0;

    const result = await runModelAction({
      start: async () => {},
      getState: async () => states[callIndex++],
      sleep: fakeSleep().sleep,
      intervalMs: 10,
    });

    expect(result).toBe(finalState);
    if ("cancelled" in result) {
      throw new Error("expected a StateResponse, not a cancelled outcome");
    }
    expect(result.operation.error).toBe(
      "Insufficient memory to load llama3:70b"
    );
  });

  it("propagates an error from start unchanged, without polling getState", async () => {
    const startError = new Error("unknown_model");
    let getStateCalls = 0;

    await expect(
      runModelAction({
        start: async () => {
          throw startError;
        },
        getState: async () => {
          getStateCalls++;
          return stateWith({ kind: "idle" });
        },
        sleep: fakeSleep().sleep,
      })
    ).rejects.toBe(startError);

    expect(getStateCalls).toBe(0);
  });

  it("rejects with a clear error if the operation never goes idle within maxWaitMs", async () => {
    const { sleep, calls: sleepCalls } = fakeSleep();

    await expect(
      runModelAction({
        start: async () => {},
        getState: async () => stateWith({ kind: "loading", model: "m" }),
        sleep,
        intervalMs: 100,
        maxWaitMs: 300,
      })
    ).rejects.toThrow(/timed out/i);

    // Polls at elapsed 0, 100, 200, 300 (4 polls), sleeping between each of
    // the first three before giving up once elapsed reaches maxWaitMs.
    expect(sleepCalls).toEqual([100, 100, 100]);
  });
});

describe("runModelAction confirmation (FR6)", () => {
  it("on confirmation_required, asks confirm; a true reply retries start with confirm true, then polls to idle", async () => {
    const finalState = stateWith({ kind: "idle" });
    const states = [stateWith({ kind: "loading", model: "llama3:70b" }), finalState];
    let callIndex = 0;
    const startCalls: boolean[] = [];
    const confirmReasons: string[][] = [];

    const result = await runModelAction({
      start: async (confirm) => {
        startCalls.push(confirm);
        if (!confirm) {
          throw new ConfirmationRequiredError("Are you sure?", [
            "reply_in_progress",
          ]);
        }
      },
      confirm: async (reasons) => {
        confirmReasons.push(reasons);
        return true;
      },
      getState: async () => states[callIndex++],
      sleep: fakeSleep().sleep,
      intervalMs: 10,
    });

    expect(startCalls).toEqual([false, true]);
    expect(confirmReasons).toEqual([["reply_in_progress"]]);
    expect(result).toBe(finalState);
    expect((result as StateResponse).operation.kind).toBe("idle");
  });

  it("on confirmation_required, a false reply from confirm makes no further start call, does not poll, and resolves cancelled", async () => {
    const startCalls: boolean[] = [];
    let getStateCalls = 0;

    const result = await runModelAction({
      start: async (confirm) => {
        startCalls.push(confirm);
        throw new ConfirmationRequiredError("Are you sure?", [
          "not_loaded_by_server",
        ]);
      },
      confirm: async () => false,
      getState: async () => {
        getStateCalls++;
        return stateWith({ kind: "idle" });
      },
      sleep: fakeSleep().sleep,
    });

    expect(startCalls).toEqual([false]);
    expect(getStateCalls).toBe(0);
    expect(result).toEqual({ cancelled: true });
  });

  it("propagates a non-confirmation error from start unchanged, without asking confirm", async () => {
    const startError = new Error("unknown_model");
    let confirmCalls = 0;

    await expect(
      runModelAction({
        start: async () => {
          throw startError;
        },
        confirm: async () => {
          confirmCalls++;
          return true;
        },
        getState: async () => stateWith({ kind: "idle" }),
        sleep: fakeSleep().sleep,
      })
    ).rejects.toBe(startError);

    expect(confirmCalls).toBe(0);
  });

  it("propagates ConfirmationRequiredError unchanged when no confirm callback is given", async () => {
    const confirmationError = new ConfirmationRequiredError("Are you sure?", [
      "reply_in_progress",
    ]);

    await expect(
      runModelAction({
        start: async () => {
          throw confirmationError;
        },
        getState: async () => stateWith({ kind: "idle" }),
        sleep: fakeSleep().sleep,
      })
    ).rejects.toBe(confirmationError);
  });
});
