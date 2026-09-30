import { describe, it, expect } from "bun:test";
import { createWebTools, type WebEvent, type StepEvent } from "./tools";

type Seen = { path: string; body: any };

/** A fake search service on port 0; `handler` produces the response per path. */
function fakeSearch(
  handler: (path: string, body: any) => Promise<Response> | Response,
) {
  const seen: Seen[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const body = await req.json().catch(() => null);
      seen.push({ path, body });
      return handler(path, body);
    },
  });
  return { server, seen, baseUrl: `http://127.0.0.1:${server.port}` };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const call = (name: string, args: Record<string, unknown>) => ({
  function: { name, arguments: args },
});

const steps = (events: WebEvent[]) =>
  events.filter((e): e is StepEvent => e.type === "step");

describe("createWebTools", () => {
  it("tools() returns web_search and read_page function tools", () => {
    const t = createWebTools().tools();
    expect(t.length).toBe(2);
    const byName = Object.fromEntries(t.map((x: any) => [x.function.name, x]));
    expect(Object.keys(byName).sort()).toEqual(["read_page", "web_search"]);
    for (const x of t) {
      expect(x.type).toBe("function");
      expect(x.function.description.length).toBeGreaterThan(10);
      expect(x.function.parameters.type).toBe("object");
    }
    expect(byName.web_search.function.parameters.required).toEqual(["query"]);
    expect(byName.web_search.function.parameters.properties.query.type).toBe("string");
    expect(byName.read_page.function.parameters.required).toEqual(["url"]);
    expect(byName.read_page.function.parameters.properties.url.type).toBe("string");
  });

  it("systemNote contains the local ISO date and weekday/month words", () => {
    const now = new Date(2026, 8, 30, 12, 0, 0); // Wed 30 Sep 2026 local
    const note = createWebTools().systemNote(now);
    expect(note).toContain("2026-09-30");
    expect(note).toContain("Wednesday");
    expect(note).toContain("September");
    expect(note).toContain("web_search");
    expect(note).toContain("read_page");
  });

  it("systemNote carries the FR30 guidance", () => {
    const note = createWebTools().systemNote(new Date(2026, 8, 30, 12, 0, 0));
    expect(note).toContain("broad or open-ended");
    expect(note).toContain("more than one");
    expect(note).toContain("exact date");
    expect(note).toContain("three different websites");
    expect(note).toContain("markdown link");
    expect(note).toContain("copied exactly");
    expect(note).toContain("tables");
    expect(note).toContain("narrow");
  });

  it("web_search 200: events, sources, result text and request body", async () => {
    const f = fakeSearch(() =>
      json(200, {
        backend: "ddgs",
        results: [
          { url: "https://a.example/1", title: "Alpha", snippet: "first snippet" },
          { url: "https://b.example/2", title: "Beta", snippet: "second snippet" },
        ],
      }),
    );
    try {
      const w = createWebTools({ baseUrl: f.baseUrl });
      const { toolResult, events } = await w.execute(
        call("web_search", { query: "cats" }),
        new AbortController().signal,
      );
      expect(f.seen).toEqual([{ path: "/v1/search", body: { query: "cats", max_results: 5 } }]);
      expect(events.map((e: WebEvent) => e.type)).toEqual(["step", "step", "source", "source"]);
      const [s1, s2] = steps(events);
      expect(s1!.data).toMatchObject({ kind: "search", status: "started", query: "cats" });
      expect(s2!.data.status).toBe("done");
      expect(s2!.data.step_id).toBe(s1!.data.step_id);
      expect(events[2]).toEqual({ type: "source", data: { title: "Alpha", url: "https://a.example/1" } });
      expect(events[3]).toEqual({ type: "source", data: { title: "Beta", url: "https://b.example/2" } });
      expect(toolResult).toContain("1. Alpha");
      expect(toolResult).toContain("https://a.example/1");
      expect(toolResult).toContain("first snippet");
      expect(toolResult).toContain("2. Beta");
    } finally {
      f.server.stop(true);
    }
  });

  it("web_search empty results: done, no sources, clear no-results text", async () => {
    const f = fakeSearch(() => json(200, { results: [], backend: "ddgs" }));
    try {
      const w = createWebTools({ baseUrl: f.baseUrl });
      const { toolResult, events } = await w.execute(
        call("web_search", { query: "zzz" }),
        new AbortController().signal,
      );
      expect(events.map((e: WebEvent) => e.type)).toEqual(["step", "step"]);
      expect(steps(events)[1]!.data.status).toBe("done");
      expect(toolResult.toLowerCase()).toContain("no results");
    } finally {
      f.server.stop(true);
    }
  });

  it("web_search 503 search_unavailable -> unavailable", async () => {
    const f = fakeSearch(() => json(503, { error: "search_unavailable", detail: "x" }));
    try {
      const w = createWebTools({ baseUrl: f.baseUrl });
      const { toolResult, events } = await w.execute(
        call("web_search", { query: "q" }),
        new AbortController().signal,
      );
      const s = steps(events);
      expect(events.length).toBe(2);
      expect(s[1]!.data).toMatchObject({ status: "unavailable", detail: "search_unavailable" });
      expect(s[1]!.data.step_id).toBe(s[0]!.data.step_id);
      expect(toolResult.toLowerCase()).toContain("unavailable");
      expect(toolResult.toLowerCase()).toContain("answer");
    } finally {
      f.server.stop(true);
    }
  });

  it("web_search 504 -> failed with error code", async () => {
    const f = fakeSearch(() => json(504, { error: "timeout" }));
    try {
      const w = createWebTools({ baseUrl: f.baseUrl });
      const { toolResult, events } = await w.execute(
        call("web_search", { query: "q" }),
        new AbortController().signal,
      );
      expect(steps(events)[1]!.data).toMatchObject({ status: "failed", detail: "timeout" });
      expect(toolResult.toLowerCase()).toContain("failed");
      expect(toolResult.toLowerCase()).toContain("answer");
    } finally {
      f.server.stop(true);
    }
  });

  it("network error -> failed network_error", async () => {
    const f = fakeSearch(() => json(200, {}));
    const baseUrl = f.baseUrl;
    f.server.stop(true);
    const w = createWebTools({ baseUrl });
    const { events } = await w.execute(
      call("web_search", { query: "q" }),
      new AbortController().signal,
    );
    expect(steps(events)[1]!.data).toMatchObject({ status: "failed", detail: "network_error" });
  });

  it("read_page 200: truncated note, source uses final_url", async () => {
    const f = fakeSearch(() =>
      json(200, {
        url: "https://p.example/a",
        final_url: "https://p.example/b",
        title: "Page T",
        markdown: "# Hello body",
        truncated: true,
      }),
    );
    try {
      const w = createWebTools({ baseUrl: f.baseUrl });
      const { toolResult, events } = await w.execute(
        call("read_page", { url: "https://p.example/a" }),
        new AbortController().signal,
      );
      expect(f.seen).toEqual([{ path: "/v1/read", body: { url: "https://p.example/a" } }]);
      expect(events.map((e: WebEvent) => e.type)).toEqual(["step", "step", "source"]);
      const s = steps(events);
      expect(s[0]!.data).toMatchObject({ kind: "read", status: "started", url: "https://p.example/a" });
      expect(s[1]!.data.status).toBe("done");
      expect(s[1]!.data.step_id).toBe(s[0]!.data.step_id);
      expect(events[2]).toEqual({ type: "source", data: { title: "Page T", url: "https://p.example/b" } });
      expect(toolResult).toContain("Page T");
      expect(toolResult).toContain("https://p.example/b");
      expect(toolResult).toContain("# Hello body");
      expect(toolResult.toLowerCase()).toContain("truncated");
    } finally {
      f.server.stop(true);
    }
  });

  it("read_page 200 not truncated has no truncated note", async () => {
    const f = fakeSearch(() =>
      json(200, { url: "u", final_url: "https://p.example/b", title: "T", markdown: "body", truncated: false }),
    );
    try {
      const w = createWebTools({ baseUrl: f.baseUrl });
      const { toolResult } = await w.execute(
        call("read_page", { url: "https://p.example/a" }),
        new AbortController().signal,
      );
      expect(toolResult.toLowerCase()).not.toContain("truncated");
    } finally {
      f.server.stop(true);
    }
  });

  it("read_page 400 blocked_destination -> failed with detail", async () => {
    const f = fakeSearch(() => json(400, { error: "blocked_destination" }));
    try {
      const w = createWebTools({ baseUrl: f.baseUrl });
      const { toolResult, events } = await w.execute(
        call("read_page", { url: "http://127.0.0.1/" }),
        new AbortController().signal,
      );
      expect(events.length).toBe(2);
      expect(steps(events)[1]!.data).toMatchObject({ status: "failed", detail: "blocked_destination" });
      expect(toolResult).toContain("blocked_destination");
      expect(toolResult.toLowerCase()).toContain("could not");
    } finally {
      f.server.stop(true);
    }
  });

  it("client timeout -> failed 'timeout', resolves rather than rejects", async () => {
    const f = fakeSearch(async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return json(200, { results: [] });
    });
    try {
      const w = createWebTools({ baseUrl: f.baseUrl, timeoutMs: 50 });
      const { events } = await w.execute(
        call("web_search", { query: "slow" }),
        new AbortController().signal,
      );
      expect(steps(events)[1]!.data).toMatchObject({ status: "failed", detail: "timeout" });
    } finally {
      f.server.stop(true);
    }
  });

  it("caller abort -> execute rejects", async () => {
    const f = fakeSearch(async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return json(200, { results: [] });
    });
    try {
      const w = createWebTools({ baseUrl: f.baseUrl });
      const ac = new AbortController();
      const p = w.execute(call("web_search", { query: "slow" }), ac.signal);
      setTimeout(() => ac.abort(), 50);
      await expect(p).rejects.toBeDefined();
    } finally {
      f.server.stop(true);
    }
  });

  it("unknown tool or bad argument -> no request, no step events, explanatory result", async () => {
    const f = fakeSearch(() => json(200, {}));
    try {
      const w = createWebTools({ baseUrl: f.baseUrl });
      const sig = new AbortController().signal;
      for (const c of [
        call("launch_missiles", {}),
        call("web_search", {}),
        call("web_search", { query: 5 }),
        call("read_page", { url: null }),
      ]) {
        const { toolResult, events } = await w.execute(c, sig);
        expect(events).toEqual([]);
        expect(toolResult.length).toBeGreaterThan(0);
      }
      expect(f.seen.length).toBe(0);
    } finally {
      f.server.stop(true);
    }
  });

  it("step ids are unique across steps", async () => {
    const f = fakeSearch(() => json(200, { results: [] }));
    try {
      const w = createWebTools({ baseUrl: f.baseUrl });
      const sig = new AbortController().signal;
      const a = await w.execute(call("web_search", { query: "a" }), sig);
      const b = await w.execute(call("web_search", { query: "b" }), sig);
      expect(steps(a.events)[0]!.data.step_id).not.toBe(steps(b.events)[0]!.data.step_id);
    } finally {
      f.server.stop(true);
    }
  });
});

describe("createWebTools icon()", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const fakeFetch = (impl: (url: string) => Promise<Response> | Response) =>
    ((input: any) => Promise.resolve(impl(String(input)))) as unknown as typeof fetch;
  const sig = () => new AbortController().signal;

  it("200 image/* returns bytes + contentType and URL-encodes the host", async () => {
    let seenUrl = "";
    const w = createWebTools({
      baseUrl: "http://search.test:1/",
      fetch: fakeFetch((u) => {
        seenUrl = u;
        return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      }),
    });
    const r = await w.icon("example.com", sig());
    expect(seenUrl).toBe("http://search.test:1/v1/icon?host=example.com");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(Array.from(r.bytes)).toEqual(Array.from(png));
      expect(r.contentType).toBe("image/png");
    }
  });

  it("URL-encodes odd host characters", async () => {
    let seenUrl = "";
    const w = createWebTools({
      baseUrl: "http://s",
      fetch: fakeFetch((u) => {
        seenUrl = u;
        return json(404, { error: "no_icon" });
      }),
    });
    await w.icon("a b&c", sig());
    expect(seenUrl).toBe("http://s/v1/icon?host=a%20b%26c");
  });

  it("404 no_icon, 400 blocked_destination and 400 bad_url are 'none'", async () => {
    for (const [status, error] of [[404, "no_icon"], [400, "blocked_destination"], [400, "bad_url"]] as const) {
      const w = createWebTools({ baseUrl: "http://s", fetch: fakeFetch(() => json(status, { error })) });
      expect(await w.icon("example.com", sig())).toEqual({ kind: "none" });
    }
  });

  it("200 with a non-image content type is unavailable", async () => {
    const w = createWebTools({
      baseUrl: "http://s",
      fetch: fakeFetch(() => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })),
    });
    expect(await w.icon("example.com", sig())).toEqual({ kind: "unavailable", timeout: false });
  });

  it("5xx is unavailable (not a timeout); 504 timeout is unavailable with timeout", async () => {
    const w500 = createWebTools({ baseUrl: "http://s", fetch: fakeFetch(() => json(500, { error: "boom" })) });
    expect(await w500.icon("example.com", sig())).toEqual({ kind: "unavailable", timeout: false });
    const w504 = createWebTools({ baseUrl: "http://s", fetch: fakeFetch(() => json(504, { error: "timeout" })) });
    expect(await w504.icon("example.com", sig())).toEqual({ kind: "unavailable", timeout: true });
  });

  it("network error is unavailable; client timeout is unavailable with timeout", async () => {
    const down = createWebTools({
      baseUrl: "http://s",
      fetch: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
    });
    expect(await down.icon("example.com", sig())).toEqual({ kind: "unavailable", timeout: false });

    const hang = createWebTools({
      baseUrl: "http://s",
      iconTimeoutMs: 20,
      fetch: ((_u: any, init: any) =>
        new Promise((_res, rej) =>
          init.signal.addEventListener("abort", () => rej(new Error("aborted"))),
        )) as unknown as typeof fetch,
    });
    expect(await hang.icon("example.com", sig())).toEqual({ kind: "unavailable", timeout: true });
  });

  it("caller abort rejects", async () => {
    const ac = new AbortController();
    ac.abort(new Error("stop"));
    const w = createWebTools({ baseUrl: "http://s", fetch: fakeFetch(() => json(404, {})) });
    await expect(w.icon("example.com", ac.signal)).rejects.toThrow("stop");
  });
});
