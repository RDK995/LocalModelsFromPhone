/**
 * C12 web tools (architecture I15): the `web_search` / `read_page` tools the
 * model may call, executed against the search service C13 over I16.
 *
 * Types are defined locally (structurally compatible with Ollama's tool format).
 */

export type WebTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type WebToolCall = {
  function: { name: string; arguments: Record<string, unknown> };
};

export type StepEvent = {
  type: "step";
  data: {
    step_id: string;
    kind: "search" | "read" | "continue" | "answer_now";
    status: "started" | "done" | "failed" | "unavailable";
    query?: string;
    url?: string;
    detail?: string;
  };
};

export type SourceEvent = { type: "source"; data: { title: string; url: string; n?: number } };
export type WebEvent = StepEvent | SourceEvent;

export type WebToolsOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Client timeout per request; must exceed the search service's own 25 s limit. */
  timeoutMs?: number;
  /** Client timeout for icon requests (default 15 s). */
  iconTimeoutMs?: number;
};

/**
 * Outcome of `icon()`: `ok` with image bytes; `none` when the site has no icon,
 * refuses, or is blocked (C13 404 no_icon / 400 blocked_destination|bad_url);
 * `unavailable` for 5xx, timeout or network error (`timeout: true` maps to 504).
 */
export type IconResult =
  | { kind: "ok"; bytes: Uint8Array; contentType: string }
  | { kind: "none" }
  | { kind: "unavailable"; timeout: boolean };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

type Outcome =
  | { kind: "http"; status: number; body: any }
  | { kind: "timeout" }
  | { kind: "network_error" };

export function createWebTools(opts: WebToolsOptions = {}) {
  const baseUrl = (opts.baseUrl ?? "http://127.0.0.1:7790").replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const iconTimeoutMs = opts.iconTimeoutMs ?? 15000;

  const toolDefs: WebTool[] = [
    {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the web for current information. Returns a numbered list of results with title, URL and snippet.",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "The search query." } },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_page",
        description:
          "Fetch a web page by URL and return its main text as markdown. Use it to read a page found via web_search.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "Absolute http:// or https:// URL of the page to read." },
          },
          required: ["url"],
        },
      },
    },
  ];

  /** POST JSON; caller abort rejects, client timeout/network errors become outcomes. */
  async function post(path: string, payload: unknown, signal: AbortSignal): Promise<Outcome> {
    signal.throwIfAborted();
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([signal, timeout]),
      });
      const body = await res.json().catch(() => null);
      return { kind: "http", status: res.status, body };
    } catch (err) {
      if (signal.aborted) throw signal.reason ?? err;
      if (timeout.aborted) return { kind: "timeout" };
      return { kind: "network_error" };
    }
  }

  const errorCode = (o: Outcome, fallback: string): string => {
    if (o.kind === "timeout") return "timeout";
    if (o.kind === "network_error") return "network_error";
    return typeof o.body?.error === "string" ? o.body.error : fallback;
  };

  async function webSearch(query: string, signal: AbortSignal) {
    const step_id = crypto.randomUUID();
    const events: WebEvent[] = [
      { type: "step", data: { step_id, kind: "search", status: "started", query } },
    ];
    const o = await post("/v1/search", { query, max_results: 5 }, signal);

    if (o.kind === "http" && o.status >= 200 && o.status < 300) {
      const results: { url?: string; title?: string; snippet?: string }[] = Array.isArray(o.body?.results)
        ? o.body.results
        : [];
      events.push({ type: "step", data: { step_id, kind: "search", status: "done", query } });
      for (const r of results) {
        events.push({ type: "source", data: { title: r.title ?? "", url: r.url ?? "" } });
      }
      const toolResult = results.length
        ? results
            .map((r, i) => `${i + 1}. ${r.title ?? ""}\n   ${r.url ?? ""}\n   ${r.snippet ?? ""}`)
            .join("\n")
        : `No results found for "${query}".`;
      return { toolResult, events };
    }

    const code = errorCode(o, `http_${o.kind === "http" ? o.status : "error"}`);
    const unavailable = o.kind === "http" && o.status === 503 && code === "search_unavailable";
    events.push({
      type: "step",
      data: { step_id, kind: "search", status: unavailable ? "unavailable" : "failed", query, detail: code },
    });
    const toolResult = unavailable
      ? `Web search is unavailable right now (${code}). Answer from what you already have and say that search was unavailable.`
      : `Web search failed (${code}). Answer from what you already have and say that search failed.`;
    return { toolResult, events };
  }

  async function readPage(url: string, signal: AbortSignal, numberPage?: (finalUrl: string) => number) {
    const step_id = crypto.randomUUID();
    const events: WebEvent[] = [
      { type: "step", data: { step_id, kind: "read", status: "started", url } },
    ];
    const o = await post("/v1/read", { url }, signal);

    if (o.kind === "http" && o.status >= 200 && o.status < 300) {
      const b = o.body ?? {};
      const finalUrl: string = typeof b.final_url === "string" ? b.final_url : url;
      const title: string = typeof b.title === "string" ? b.title : "";
      events.push({ type: "step", data: { step_id, kind: "read", status: "done", url } });
      const n = numberPage?.(finalUrl);
      events.push({ type: "source", data: n === undefined ? { title, url: finalUrl } : { title, url: finalUrl, n } });
      const label = n === undefined ? "" : `Page [${n}] - cite this page as [${n}]\n`;
      let toolResult = `${label}Title: ${title}\nURL: ${finalUrl}\n\n${typeof b.markdown === "string" ? b.markdown : ""}`;
      if (b.truncated === true) {
        toolResult += "\n\n[Note: the page content was truncated; only the first part is shown.]";
      }
      return { toolResult, events };
    }

    const code = errorCode(o, `http_${o.kind === "http" ? o.status : "error"}`);
    events.push({ type: "step", data: { step_id, kind: "read", status: "failed", url, detail: code } });
    return {
      toolResult: `The page could not be read (${code}). Answer from what you already have and say the page could not be read.`,
      events,
    };
  }

  async function icon(host: string, signal: AbortSignal): Promise<IconResult> {
    signal.throwIfAborted();
    const timeout = AbortSignal.timeout(iconTimeoutMs);
    try {
      const res = await doFetch(`${baseUrl}/v1/icon?host=${encodeURIComponent(host)}`, {
        signal: AbortSignal.any([signal, timeout]),
      });
      if (res.status === 200) {
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().startsWith("image/")) {
          await res.body?.cancel().catch(() => {});
          return { kind: "unavailable", timeout: false };
        }
        return { kind: "ok", bytes: new Uint8Array(await res.arrayBuffer()), contentType };
      }
      await res.body?.cancel().catch(() => {});
      if (res.status === 404 || res.status === 400) return { kind: "none" };
      return { kind: "unavailable", timeout: res.status === 504 };
    } catch (err) {
      if (signal.aborted) throw signal.reason ?? err;
      return { kind: "unavailable", timeout: timeout.aborted };
    }
  }

  return {
    icon,

    tools(): WebTool[] {
      return structuredClone(toolDefs);
    },

    systemNote(now: Date): string {
      const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      return (
        `Today's date is ${WEEKDAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()} (${iso}). ` +
        `You may use the web_search and read_page tools to get current information. ` +
        `For a broad or open-ended question (for example "today's news trends"), make at least two web_search calls (more than one query) with different angles and wording. ` +
        `Do not put the exact date into search queries. ` +
        `Then call read_page on results from at least three different websites before you answer, and always write the answer. ` +
        `You have at most 10 tool calls in total. ` +
        `Cite each page you relied on by the page number that read_page gave it, in square brackets, for example [2], including source cells inside tables. ` +
        `Cite only numbers given by read_page, and do not type URLs as citations. ` +
        `A narrow factual question need not search more than it needs.`
      );
    },

    async execute(
      call: WebToolCall,
      signal: AbortSignal,
      numberPage?: (finalUrl: string) => number,
    ): Promise<{ toolResult: string; events: WebEvent[] }> {
      const name = call.function?.name;
      const args = call.function?.arguments ?? {};
      if (name === "web_search") {
        if (typeof args.query !== "string" || args.query.trim() === "") {
          return { toolResult: "Error: web_search requires a non-empty string argument 'query'.", events: [] };
        }
        return webSearch(args.query, signal);
      }
      if (name === "read_page") {
        if (typeof args.url !== "string" || args.url.trim() === "") {
          return { toolResult: "Error: read_page requires a non-empty string argument 'url'.", events: [] };
        }
        return readPage(args.url, signal, numberPage);
      }
      return {
        toolResult: `Error: unknown tool '${String(name)}'. Available tools: web_search, read_page.`,
        events: [],
      };
    },
  };
}
