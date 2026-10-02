/**
 * M19f-AC3: a reply with error status and no answer text shows a plain line
 * with its steps, live and when reopened from storage, for deep research,
 * ordinary web and switch off.
 */

import { describe, it, expect, mock } from "bun:test";
import { APIClient } from "@/api/client";
import type { StreamEvent } from "@/api/client";
import { createConversationStore } from "@/store/conversationStore";
import type { Message } from "@/store/conversationStore";
import { createMemoryStorage } from "@/store/storagePort";
import { buildChatItems, stepLabel } from "@/ui/chatItems";
import type { PendingTurn } from "@/ui/chatItems";
import { LOST_CONNECTION_LINE } from "@/ui/errorReply";
import { applyStreamEvent, initialStreamAccumulator } from "@/ui/streamReducer";
import type { StepEventData } from "@shared/api";
import { sendInConversation } from "./conversationSession";

const BASE_URL = "https://ryans-mac-studio.tailc3648a.ts.net:8443";

function sse(events: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        i += 1;
        controller.enqueue(
          encoder.encode(`id: gen-x-${i}\nevent: step\ndata: ${JSON.stringify(e)}\n\n`)
        );
      }
      controller.close(); // a drop: no terminal event
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "x-generation-id": "gen-x" },
  });
}

async function runDroppedReply(opts: {
  steps: Array<Record<string, unknown>>;
  web: boolean;
  deepResearch: boolean;
}) {
  const storage = createMemoryStorage();
  const store = createConversationStore(storage);
  const c = await store.create();
  if (opts.web) await store.setWebSearch(c.id, true);

  let virtualNow = 0;
  const fetchMock = mock(async (url: string) => {
    if (url.endsWith("/v1/state")) {
      return new Response(
        JSON.stringify({
          deep_research_model: "dr:7b",
          models: [{ name: "dr:7b", size_bytes: 1, tools: true }],
          resident: { name: "dr:7b", loaded_by_server: true },
          operation: { kind: "idle" },
          generation: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.endsWith("/v1/chat")) return sse(opts.steps);
    throw new Error("network error"); // every resume fails
  });
  const client = new APIClient(BASE_URL, fetchMock as unknown as typeof fetch, {
    now: () => virtualNow,
    sleep: async (ms: number) => {
      virtualNow += 200_000 + ms;
    },
  });
  client.setToken("t");

  let acc = initialStreamAccumulator;
  let errored: Error | null = null;
  await sendInConversation(
    client,
    store,
    c.id,
    "hi",
    {
      onEvent: (e: StreamEvent) => {
        acc = applyStreamEvent(acc, e);
      },
      onBlocked: () => {},
      onError: (e: Error) => {
        errored = e;
      },
      onUnauthorized: () => {},
      onComplete: () => {},
    },
    { userMessageId: "u1", assistantMessageId: "a1", deepResearch: opts.deepResearch }
  );
  expect(errored).not.toBeNull();

  const persisted = (await store.get(c.id))!.messages;
  const pending: PendingTurn = {
    userMessageId: "u1",
    prompt: "hi",
    assistantMessageId: "a1",
    accumulator: acc,
    blocked: false,
  };
  const live = buildChatItems(persisted, pending).find((i) => i.key === "a1")!;
  // Reopened: a fresh store over the same storage (serialise + validate).
  const reopenedMessages = (await createConversationStore(storage).get(c.id))!.messages;
  const reopened = buildChatItems(reopenedMessages, null).find((i) => i.key === "a1")!;
  return { live, reopened };
}

const st = (step_id: string, kind: string, status: string, extra: Record<string, unknown> = {}) => ({
  step_id,
  kind,
  status,
  ...extra,
});

describe("error reply with no answer text (M19f-AC3)", () => {
  it("deep research: plain line and steps incl. model steps, live and reopened", async () => {
    const { live, reopened } = await runDroppedReply({
      web: true,
      deepResearch: true,
      steps: [
        st("p", "plan", "done"),
        st("s1", "search", "done", { query: "q" }),
        st("r1", "read", "done", { url: "https://www.example.com/a" }),
      ],
    });
    for (const item of [live, reopened]) {
      expect(item.errorLine).toBe(LOST_CONNECTION_LINE);
      expect(item.content).toBe("");
      expect(item.steps!.map(stepLabel)).toEqual([
        "Planning",
        "Searching: q",
        "Reading: example.com",
      ]);
    }
    expect(reopened.steps).toEqual(live.steps);
  });

  it("deep research: model steps stored on an error reply are shown after reopening", async () => {
    const storage = createMemoryStorage();
    const store = createConversationStore(storage);
    const c = await store.create();
    await store.appendMessage(c.id, {
      id: "a1",
      role: "assistant",
      content: "",
      status: "error",
      steps: [
        st("m1", "model", "done", { detail: "Choosing pages" }) as StepEventData,
        st("m2", "model", "started", { detail: "Taking notes: example.com" }) as StepEventData,
      ],
    });
    const messages = (await createConversationStore(storage).get(c.id))!.messages;
    const item = buildChatItems(messages, null)[0];
    expect(item.errorLine).toBe(LOST_CONNECTION_LINE);
    expect(item.steps!.map(stepLabel)).toEqual(["Choosing pages", "Taking notes: example.com"]);
  });

  it("ordinary web: plain line and steps, live and reopened", async () => {
    const { live, reopened } = await runDroppedReply({
      web: true,
      deepResearch: false,
      steps: [st("s1", "search", "done", { query: "q" }), st("r1", "read", "done", { url: "https://t.test" })],
    });
    for (const item of [live, reopened]) {
      expect(item.errorLine).toBe(LOST_CONNECTION_LINE);
      expect(item.steps!.map(stepLabel)).toEqual(["Searching: q", "Reading: t.test"]);
    }
  });

  it("switch off: plain line with no steps, live and reopened", async () => {
    const { live, reopened } = await runDroppedReply({ web: false, deepResearch: false, steps: [] });
    for (const item of [live, reopened]) {
      expect(item.errorLine).toBe(LOST_CONNECTION_LINE);
      expect(item.steps).toBeUndefined();
    }
  });
});

describe("store: model steps and error_message survive reload", () => {
  it("keeps a message with a kind model step (dropped before STEP_KINDS accepted it)", async () => {
    const storage = createMemoryStorage();
    const store = createConversationStore(storage);
    const c = await store.create();
    const m: Message = {
      id: "a1",
      role: "assistant",
      content: "",
      status: "error",
      error_message: "x",
      steps: [{ step_id: "m1", kind: "model", status: "done", detail: "Checking for gaps" }],
    };
    await store.appendMessage(c.id, m);
    const reopened = await createConversationStore(storage).get(c.id);
    expect(reopened).not.toBeNull();
    expect(reopened!.messages[0]).toEqual(m);
  });

  it("drops a conversation whose error_message is not a string", async () => {
    const storage = createMemoryStorage();
    const store = createConversationStore(storage);
    const c = await store.create();
    await store.appendMessage(c.id, {
      id: "a1",
      role: "assistant",
      content: "",
      status: "error",
      error_message: 5 as unknown as string,
    });
    expect(await createConversationStore(storage).get(c.id)).toBeNull();
  });
});
