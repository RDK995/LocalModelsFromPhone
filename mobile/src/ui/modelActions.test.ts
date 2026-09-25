/**
 * Behavioural tests for the pure Load/Unload polling helper behind the
 * Models screen (src/app/models.tsx): starting the operation, then polling
 * `GET /v1/state` until it goes idle, with a fake `sleep` so the poll loop
 * runs without waiting in real time.
 */

import { describe, it, expect } from "bun:test";
import { runModelAction } from "./modelActions";
import type { StateResponse } from "@shared/api";

function stateWith(operation: StateResponse["operation"]): StateResponse {
  return {
    models: [{ name: "llama3:70b", size_bytes: 39_000_000_000 }],
    resident: null,
    operation,
    generation: null,
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
