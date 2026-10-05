import { describe, it, expect, spyOn } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import { SYSTEM_INSTRUCTIONS, type ResearchSettings, type ResearchWebTools } from "../generations/research";
import type { WebEvent } from "../web/tools";
import { classifyPage } from "@shared/readability";

const TOKEN = "test-token";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` });

function chunk(content: string, done: boolean): OllamaChatResponse {
  return {
    model: "fake-model",
    created_at: "",
    message: { role: "assistant", content },
    done,
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: 0,
    eval_duration: 0,
  } as OllamaChatResponse;
}

function parseSSE(text: string): Array<{ id: string; event: string; data: string }> {
  return text
    .split("\n\n")
    .map((b) => b.split("\n").filter((l) => !l.startsWith(":")).join("\n"))
    .filter((b) => b.trim().length > 0)
    .map((b) => {
      const lines = b.split("\n");
      return {
        id: lines.find((l) => l.startsWith("id: "))?.slice(4) ?? "",
        event: lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "",
        data: lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "",
      };
    });
}

const SUB_QUESTION = "zebra migration routes";
const REPORT = "Zebras migrate along rivers [1] and graze [2].";

/** Which page a notes request is for, and the untrusted block that starts its user message. */
function noteBlock(request: any): { n: number; body: string } | null {
  if (!Object.keys(request.format?.properties ?? {}).includes("notes")) return null;
  const m = String(request.messages[1].content).match(/^<untrusted_data source="page (\d+)">\n([\s\S]*?)\n<\/untrusted_data>/);
  return m ? { n: Number(m[1]), body: m[2]! } : null;
}
const isNotes = (request: any) => Object.keys(request.format?.properties ?? {}).includes("notes");

interface SetupOptions {
  research?: Partial<ResearchSettings>;
  /** Page text by URL. */
  pageText: (url: string) => string;
  /** Notes reply for the page block of a notes request. */
  notes?: (block: { n: number; body: string }) => Array<{ quote: string; claim: string }>;
  /** Plan reply; defaults to the single SUB_QUESTION. When set, only the first sub-question chooses pages to read. */
  subQuestions?: string[];
}

function setup(opts: SetupOptions) {
  const requests: any[] = [];
  const client: OllamaStateClient = {
    tags: async () => ({ models: [{ name: "fake-model", modified_at: "", size: 1, digest: "d" }] }),
    ps: async () =>
      ({
        models: [{ name: "fake-model", model: "fake-model", size: 1, digest: "d", details: { family: "", parameter_size: "", quantization_level: "" }, expires_at: "", size_vram: 0 }],
      }) as any,
    show: async () => ({ capabilities: ["completion", "tools"] }),
    load: async () => {},
    unload: async () => {},
    chat: ((request: any) => {
      requests.push(JSON.parse(JSON.stringify(request)));
      const keys = Object.keys(request.format?.properties ?? {});
      let reply: unknown;
      if (keys.includes("brief")) reply = { brief: "About zebras" };
      else if (keys.includes("sub_questions")) reply = { sub_questions: opts.subQuestions ?? [SUB_QUESTION] };
      else if (keys.includes("queries")) reply = { queries: ["alpha", "beta", "gamma"] };
      else if (keys.includes("pages")) reply = { pages: opts.subQuestions && !String(request.messages[1].content).includes("(1 of ") ? [] : [1, 2, 3, 4] };
      else if (keys.includes("notes")) {
        const block = noteBlock(request);
        reply = { notes: block && opts.notes ? opts.notes(block) : [] };
      } else if (keys.includes("enough")) reply = { enough: true };
      else if (keys.includes("report")) reply = { report: REPORT };
      else throw new Error("unknown step");
      const content = JSON.stringify(reply);
      return (async function* () {
        yield chunk(content, false);
        yield chunk("", true);
      })();
    }) as never,
  };
  let id = 0;
  const research: ResearchWebTools = {
    async search(query) {
      const results = [1, 2, 3].map((i) => ({ title: `T ${query} ${i}`, url: `https://${query}.example/${i}`, snippet: "s" }));
      const step_id = `s${++id}`;
      const events: WebEvent[] = [
        { type: "step", data: { step_id, kind: "search", status: "started", query } },
        { type: "step", data: { step_id, kind: "search", status: "done", query } },
      ];
      return { results, events };
    },
    async read(url, _signal, numberPage) {
      const step_id = `r${++id}`;
      const title = "Zebra Atlas";
      // FR47: like the real reader, an unreadable page is not numbered and is not a source.
      const verdict = classifyPage({ title, text: opts.pageText(url) });
      if (!verdict.readable) {
        const failed: WebEvent[] = [
          { type: "step", data: { step_id, kind: "read", status: "started", url } },
          { type: "step", data: { step_id, kind: "read", status: "failed", url, detail: verdict.reason === "blocked" ? "bot_check" : "no_content" } },
        ];
        return { page: null, events: failed, unreadable: { url, reason: verdict.reason, detail: verdict.detail } };
      }
      const n = numberPage(url);
      const events: WebEvent[] = [
        { type: "step", data: { step_id, kind: "read", status: "started", url } },
        { type: "step", data: { step_id, kind: "read", status: "done", url } },
        { type: "source", data: { title, url, n } },
      ];
      return { page: { n, title, url, text: opts.pageText(url), truncated: false }, events };
    },
  };
  const web: GenerationWebTools & ResearchWebTools = {
    tools: () => [],
    systemNote: () => "SYSTEM NOTE",
    execute: async () => ({ toolResult: "", events: [] }),
    ...research,
  };
  setValidToken(TOKEN);
  const server = createServer({ ollama: client, manager: new GenerationManager(client, web, opts.research), port: 0, researchModel: "fake-model" });
  const base = `http://127.0.0.1:${server.port}`;
  const run = async () => {
    const res = await fetch(`${base}/v1/chat`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: "cats?" }], web: true, deep_research: true }),
    });
    expect(res.status).toBe(200);
    return parseSSE(await res.text());
  };
  return { requests, server, run };
}

/** A readable, relevant page (well over 40 plain words) with the given paragraphs after the lead. */
function page(...paragraphs: string[]): string {
  const lead =
    `Our ${SUB_QUESTION} study found that herds follow the rivers each year. ` +
    "Calves follow their mothers across the shallow crossings and rangers count the herds each season. " +
    `The ${SUB_QUESTION} also depend on seasonal rainfall and fresh grass across the open plains of the region.`;
  return [lead, ...paragraphs].join("\n\n");
}

/** Runs one deep research pass over `pageText` where the fake model returns `quotes` for page 1. */
async function runOne(pageText: string, quotes: string[]) {
  const s = setup({
    pageText: () => pageText,
    research: { pagesPerSubQuestion: 1 },
    subQuestions: [SUB_QUESTION],
    notes: () => quotes.map((quote, i) => ({ quote, claim: `claim-${i}` })),
  });
  try {
    const events = await s.run();
    const write = s.requests[s.requests.length - 1];
    expect(Object.keys(write.format.properties)).toContain("report");
    const writeText = String(write.messages[1].content);
    const sources = JSON.parse(events.find((e) => e.event === "sources")!.data).items as Array<{ url: string; n: number }>;
    return { events, writeText, sources };
  } finally {
    s.server.stop(true);
  }
}

const hasNote = (writeText: string, n: number, i: number, quote: string) =>
  writeText.includes(`- [${n}] claim-${i} (quote: "${quote}")`);

// Each case: the page carries the variant and the quote the plain form (or the reverse), so the
// pre-FR48 exact check (whitespace-collapsed substring) would have dropped the note.
const KEPT: Array<{ name: string; page: string; quote: string }> = [
  { name: "curly apostrophe on the page, straight in the quote", page: "The herd’s leader picks the crossing at dawn.", quote: "The herd's leader picks the crossing at dawn." },
  { name: "straight apostrophe on the page, curly in the quote", page: "The herd's leader picks the crossing at dawn.", quote: "The herd’s leader picks the crossing at dawn." },
  { name: "curly double quotes on the page", page: "Locals called it “the great trek” in every village.", quote: 'Locals called it "the great trek" in every village.' },
  { name: "en dash on the page, hyphen in the quote", page: "The 2019–2021 survey counted every herd.", quote: "The 2019-2021 survey counted every herd." },
  { name: "em dash on the page, hyphen in the quote", page: "Rivers—and fresh grass—decide the route.", quote: "Rivers-and fresh grass-decide the route." },
  { name: "hyphen on the page, en dash in the quote", page: "The 2019-2021 survey counted every herd.", quote: "The 2019–2021 survey counted every herd." },
  { name: "letter case and line breaks", page: "Calves follow\n   their mothers across\nthe shallow crossings.", quote: "CALVES FOLLOW THEIR MOTHERS ACROSS THE SHALLOW CROSSINGS." },
  { name: "ligature (U+FB01) on the page", page: "The ﬁnal crossing is the widest of all.", quote: "The final crossing is the widest of all." },
  { name: "non-breaking space and case", page: "Rangers count herds at dawn.", quote: "RANGERS COUNT HERDS AT DAWN." },
  { name: "fullwidth digits (compatibility form) on the page", page: "Rangers count ４８２１ herds each season.", quote: "Rangers count 4821 herds each season." },
  { name: "markdown link on the page", page: "The accord followed [Treaty of Versailles](https://en.wikipedia.org/wiki/Treaty_of_Versailles) talks.", quote: "Treaty of Versailles" },
  { name: "markdown image alt text on the page", page: "See ![Map of the northern crossing](https://example.com/map.png) for details.", quote: "Map of the northern crossing" },
  { name: "bold emphasis on the page", page: "The herds are **extremely loyal** to their routes.", quote: "The herds are extremely loyal to their routes." },
  { name: "italic underscores on the page", page: "The herds _never_ skip the river crossing.", quote: "The herds never skip the river crossing." },
];

describe("deep research quote matching (M23 FR48)", () => {
  for (const c of KEPT) {
    it(`(a) keeps a note whose quote differs only by: ${c.name}`, async () => {
      const { writeText, sources } = await runOne(page(c.page), [c.quote]);
      // The note is kept as the model's own text, whitespace-collapsed, citing page 1.
      expect(hasNote(writeText, 1, 0, c.quote.replace(/\s+/g, " ").trim())).toBe(true);
      expect(sources.map((x) => x.n)).toEqual([1]);
    });
  }

  it("(a) all variants together in one run are all kept and cite page 1", async () => {
    const { writeText, sources } = await runOne(page(...KEPT.map((c) => c.page)), KEPT.map((c) => c.quote));
    KEPT.forEach((c, i) => expect(hasNote(writeText, 1, i, c.quote.replace(/\s+/g, " ").trim())).toBe(true));
    expect(sources.map((x) => x.n)).toEqual([1]);
  });

  it("(b) keeps ellipsis quotes ('…' and '...') whose pieces come from two paragraphs in page order", async () => {
    const p1 = "The herds gather beside the northern river before the long dry season begins.";
    const p2 = "Afterwards the zebras scatter across the southern plains looking for tender shoots.";
    const { writeText, sources } = await runOne(page(p1, p2), [
      "The herds gather beside the northern river… zebras scatter across the southern plains",
      "THE HERDS GATHER ... tender shoots.",
    ]);
    expect(writeText).toContain("claim-0");
    expect(writeText).toContain("claim-1");
    expect(writeText).toContain("[1] claim-0");
    expect(writeText).toContain("[1] claim-1");
    expect(sources.map((x) => x.n)).toEqual([1]);
  });

  it("(c) drops a quote whose words are not on the page (one number changed)", async () => {
    const { writeText } = await runOne(page("Rangers count 4821 herds each season."), [
      "Rangers count 4821 herds each season.",
      "Rangers count 4822 herds each season.",
    ]);
    expect(writeText).toContain("claim-0");
    expect(writeText).not.toContain("claim-1");
    expect(writeText).not.toContain("4822");
  });

  it("(d) drops an ellipsis quote whose pieces are on the page only in reverse order", async () => {
    const p1 = "The herds gather beside the northern river before the long dry season begins.";
    const p2 = "Afterwards the zebras scatter across the southern plains looking for tender shoots.";
    const { writeText } = await runOne(page(p1, p2), [
      "The herds gather beside the northern river ... tender shoots",
      "tender shoots ... The herds gather beside the northern river",
      "zebras scatter across the southern plains… the herds gather beside",
    ]);
    expect(writeText).toContain("claim-0");
    expect(writeText).not.toContain("claim-1");
    expect(writeText).not.toContain("claim-2");
  });

  it("(e) FR37 unchanged: citations resolve to saved sources numbered 1..n in read order; a page whose only note was dropped is still a source", async () => {
    const pages: Record<string, string> = {
      "https://alpha.example/1": page("The herd’s leader picks the crossing at dawn."),
      "https://alpha.example/2": page("Quokkas hum softly at dusk on remote islands."),
    };
    const s = setup({
      pageText: (url) => pages[url]!,
      research: { pagesPerSubQuestion: 2 },
      subQuestions: [SUB_QUESTION],
      notes: (block) =>
        block.n === 1
          ? [{ quote: "The herd's leader picks the crossing at dawn.", claim: "claim kept" }]
          : [{ quote: "Quokkas hum loudly at dawn on remote islands.", claim: "claim dropped" }],
    });
    try {
      const events = await s.run();
      const writeText = String(s.requests[s.requests.length - 1].messages[1].content);
      expect(writeText).toContain("- [1] claim kept");
      expect(writeText).not.toContain("claim dropped");
      const sources = JSON.parse(events.find((e) => e.event === "sources")!.data).items as Array<{ url: string; n: number }>;
      expect(sources.map((x) => [x.n, x.url])).toEqual([
        [1, "https://alpha.example/1"],
        [2, "https://alpha.example/2"],
      ]);
      const report = events
        .filter((e) => e.event === "content")
        .map((e) => JSON.parse(e.data).text ?? JSON.parse(e.data).delta ?? e.data)
        .join("");
      const cited = [...report.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      expect(cited.length).toBeGreaterThan(0);
      for (const n of cited) expect(sources.some((x) => x.n === n)).toBe(true);
    } finally {
      s.server.stop(true);
    }
  });
});

describe("deep research note dropping (M23 FR48)", () => {
  it("(a) one run with one kept note and four dropped notes logs exactly four deep_research_note_dropped lines with correct run, n, reason, and quote", async () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    const s = setup({
      pageText: () => page("The herd’s leader picks the crossing at dawn."),
      research: { pagesPerSubQuestion: 1 },
      subQuestions: [SUB_QUESTION],
      notes: () => [
        { quote: "The herd’s leader picks the crossing at dawn.", claim: "claim kept" },
        { quote: "Quokkas hum   loudly\nat dawn on remote islands.", claim: "claim dropped" },
        { quote: "a".repeat(200), claim: "claim dropped" },
        { quote: "", claim: "claim dropped" },
        { quote: "herds follow the rivers", claim: "" },
      ],
    });
    try {
      const events = await s.run();
      const logLines = spy.mock.calls.map((c) => String(c[0]));
      const drops = logLines.filter((l) => l.includes("deep_research_note_dropped")).map((l) => JSON.parse(l));

      expect(drops.length).toBe(4);

      // Extract generation id from SSE events
      const sseId = events.find((e) => e.id)?.id ?? "";
      const genId = sseId.substring(0, sseId.lastIndexOf("-"));

      // All drops have the same run id matching the generation id
      for (const drop of drops) {
        expect(drop.run).toBe(genId);
        expect(drop.n).toBe(1);
        expect(["missing_quote", "missing_claim", "quote_not_found"]).toContain(drop.reason);
        expect(drop.quote.length).toBeLessThanOrEqual(120);
      }

      // Assert exact quote values for each drop
      // quote_not_found with whitespace-collapsed quote
      expect(drops.find((d) => d.reason === "quote_not_found" && d.quote === "Quokkas hum loudly at dawn on remote islands.")).toBeDefined();

      // quote_not_found with 200-char quote cut to exactly 120
      expect(drops.find((d) => d.reason === "quote_not_found" && d.quote === "a".repeat(120))).toBeDefined();

      // missing_quote with empty quote
      expect(drops.find((d) => d.reason === "missing_quote" && d.quote === "")).toBeDefined();

      // missing_claim with quote
      expect(drops.find((d) => d.reason === "missing_claim" && d.quote === "herds follow the rivers")).toBeDefined();
    } finally {
      spy.mockRestore();
      s.server.stop(true);
    }
  });

  it("(b) the run-end line has notes_dropped: 4 and notes_kept: 1", async () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    const s = setup({
      pageText: () => page("The herd’s leader picks the crossing at dawn."),
      research: { pagesPerSubQuestion: 1 },
      subQuestions: [SUB_QUESTION],
      notes: () => [
        { quote: "The herd’s leader picks the crossing at dawn.", claim: "claim kept" },
        { quote: "Quokkas hum loudly at dawn on remote islands.", claim: "claim dropped" },
        { quote: "a".repeat(200), claim: "claim dropped" },
        { quote: "", claim: "claim dropped" },
        { quote: "herds follow the rivers", claim: "" },
      ],
    });
    try {
      await s.run();
      const logLines = spy.mock.calls.map((c) => String(c[0]));
      const ends = logLines.filter((l) => l.includes("deep_research_run_end")).map((l) => JSON.parse(l));

      expect(ends.length).toBe(1);
      expect(ends[0].notes_dropped).toBe(4);
      expect(ends[0].notes_kept).toBe(1);
    } finally {
      spy.mockRestore();
      s.server.stop(true);
    }
  });

  it("(c) a run where every note is kept has no deep_research_note_dropped line and notes_dropped: 0", async () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    const s = setup({
      pageText: () => page("The herd’s leader picks the crossing at dawn."),
      research: { pagesPerSubQuestion: 1 },
      subQuestions: [SUB_QUESTION],
      notes: () => [
        { quote: "The herd’s leader picks the crossing at dawn.", claim: "claim kept 1" },
        { quote: "herds follow the rivers", claim: "claim kept 2" },
      ],
    });
    try {
      await s.run();
      const logLines = spy.mock.calls.map((c) => String(c[0]));
      const drops = logLines.filter((l) => l.includes("deep_research_note_dropped"));
      const ends = logLines.filter((l) => l.includes("deep_research_run_end")).map((l) => JSON.parse(l));

      expect(drops.length).toBe(0);
      expect(ends.length).toBe(1);
      expect(ends[0].notes_dropped).toBe(0);
      expect(ends[0].notes_kept).toBe(2);
    } finally {
      spy.mockRestore();
      s.server.stop(true);
    }
  });
});
