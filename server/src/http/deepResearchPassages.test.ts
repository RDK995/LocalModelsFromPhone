import { describe, it, expect, spyOn } from "bun:test";
import { createServer, setValidToken, type OllamaStateClient } from "./server";
import type { OllamaChatResponse } from "../ollama/client";
import { GenerationManager, type GenerationWebTools } from "../generations/manager";
import { SYSTEM_INSTRUCTIONS, type ResearchSettings, type ResearchWebTools } from "../generations/research";
import { estimateTokens } from "../generations/passages";
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

function parseSSE(text: string): Array<{ event: string; data: string }> {
  return text
    .split("\n\n")
    .map((b) => b.split("\n").filter((l) => !l.startsWith(":")).join("\n"))
    .filter((b) => b.trim().length > 0)
    .map((b) => {
      const lines = b.split("\n");
      return {
        event: lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "",
        data: lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "",
      };
    });
}

const SUB_QUESTION = "zebra migration routes";
const REPORT = "Zebras migrate along rivers [1].";

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

const INTRO = "Intro paragraph: this atlas surveys assorted wildlife topics for curious readers.";
const MIDDLE_SENTENCES = [
  `Our ${SUB_QUESTION} study found that herds follow the rivers each year.`,
  "Calves follow their mothers across the shallow crossings.",
  "Rangers count 4821 herds each season.",
  `The ${SUB_QUESTION} also depend on seasonal rainfall and fresh grass.`,
];
const END_SENTENCE = "Quokkas hum softly at dusk on remote islands.";

function filler(k: number): string {
  return `## Section ${k}\n\n` + `Section ${k} covers ordinary gardening topics such as soil compost watering pruning mulch seeds and weather patterns in many regions. `.repeat(6);
}

/** ~6000 words: intro, 50 filler sections, one relevant section in the middle, a distinctive end sentence. */
function longPage(): string {
  const parts = [INTRO];
  for (let k = 1; k <= 50; k++) {
    if (k === 25) parts.push(`## Migration\n\n${MIDDLE_SENTENCES.join(" ")} ` + "Further notes on the herds cross the plains and rivers every single year. ".repeat(4));
    parts.push(filler(k));
  }
  parts.push(`## Trivia\n\n${END_SENTENCE}`);
  return parts.join("\n\n");
}

const taskOf = (content: string) => content.slice(content.lastIndexOf("Task:"));

describe("deep research note excerpt (M19c FR43)", () => {
  it("AC1: the note call gets title, first paragraph and relevant passages first, the task last, and a byte-stable system prefix", async () => {
    const s = setup({ pageText: () => longPage(), research: { pagesPerSubQuestion: 1 } });
    try {
      await s.run();
      const notesReqs = s.requests.filter(isNotes);
      expect(notesReqs.length).toBe(1);
      const user: string = notesReqs[0].messages[1].content;
      const block = noteBlock(notesReqs[0])!;
      expect(user.startsWith('<untrusted_data source="page 1">')).toBe(true);
      expect(block.body).toContain("Zebra Atlas");
      expect(block.body).toContain(INTRO);
      expect(block.body).toContain(MIDDLE_SENTENCES[0]!);
      expect(block.body).toContain(MIDDLE_SENTENCES[1]!);
      expect(user).not.toContain(END_SENTENCE);
      // The first paragraph is the paragraph, not the page: unrelated filler sections stay out.
      expect(block.body).not.toContain("Section 3 covers");
      expect(estimateTokens(block.body)).toBeLessThanOrEqual(2500);
      // The task text is the last thing in the user message.
      const task = taskOf(user);
      expect(task).toContain("copied exactly from the page text");
      expect(task).not.toContain("<untrusted_data");
      expect(user.endsWith(task)).toBe(true);
      // Byte-stable system message on every request, with no per-step task text.
      for (const request of s.requests) {
        expect(request.messages[0].role).toBe("system");
        expect(request.messages[0].content).toBe(SYSTEM_INSTRUCTIONS);
        expect(request.messages[0].content).not.toContain("Task:");
        expect(String(request.messages[1].content).includes("Task:")).toBe(true);
      }
    } finally {
      s.server.stop(true);
    }
  });

  it("AC1: the excerpt cap is a server setting", async () => {
    const s = setup({ pageText: () => longPage(), research: { pagesPerSubQuestion: 1, noteExcerptTokens: 600 } });
    try {
      await s.run();
      const request = s.requests.find(isNotes)!;
      const block = noteBlock(request)!;
      expect(String(request.messages[1].content).startsWith('<untrusted_data source="page 1">')).toBe(true);
      expect(estimateTokens(block.body)).toBeLessThanOrEqual(600);
      expect(estimateTokens(block.body)).toBeGreaterThan(100);
      expect(block.body).toContain(INTRO);
    } finally {
      s.server.stop(true);
    }
  });

  it("AC2: quotes are checked against the full page, and raw page text is not carried into later requests", async () => {
    const s = setup({
      pageText: () => longPage(),
      research: { pagesPerSubQuestion: 1 },
      notes: () => [
        { quote: END_SENTENCE, claim: "claim about quokkas" },
        { quote: MIDDLE_SENTENCES[1]!, claim: "claim about calves" },
        { quote: "This sentence is on no page at all.", claim: "claim invented" },
      ],
    });
    try {
      const events = await s.run();
      const noteIndex = s.requests.findIndex(isNotes);
      expect(s.requests[noteIndex].messages[1].content).not.toContain(END_SENTENCE);
      const write = s.requests[s.requests.length - 1];
      expect(Object.keys(write.format.properties)).toContain("report");
      const writeText = String(write.messages[1].content);
      expect(writeText).toContain("claim about quokkas");
      expect(writeText).toContain("claim about calves");
      expect(writeText).not.toContain("claim invented");
      expect(writeText).not.toContain("This sentence is on no page at all.");
      // The final report keeps its citation.
      const text = events.filter((e) => e.event === "content").map((e) => JSON.parse(e.data).text ?? JSON.parse(e.data).delta ?? e.data).join("");
      expect(text).toContain("[1]");
      // An unquoted raw-page sentence appears in no request after the note request.
      for (const request of s.requests.slice(noteIndex + 1)) {
        expect(JSON.stringify(request)).not.toContain("Rangers count 4821");
        expect(JSON.stringify(request)).not.toContain("Section 25 ");
      }
    } finally {
      s.server.stop(true);
    }
  });

  it("AC3: empty, blocked and irrelevant pages get no note call and one skip log line; empty and blocked pages are unnumbered and not sources (FR47)", async () => {
    const pages: Record<string, string> = {
      "https://alpha.example/1": "Zebra migration routes only a few words.",
      "https://alpha.example/2":
        "Checking your browser before accessing the site. Cloudflare. " + "Please wait while we verify your connection to the website now. ".repeat(3),
      "https://alpha.example/3": longPage(),
      "https://beta.example/1": "Pottery glazing firing kiln clay wheel ceramics studio shaping drying. ".repeat(30),
    };
    const logSpy = spyOn(console, "log");
    const s = setup({
      pageText: (url) => pages[url]!,
      research: { pagesPerSubQuestion: 4 },
      subQuestions: [SUB_QUESTION, "zebra herd feeding grounds", "zebra predators and threats"],
      notes: () => [{ quote: INTRO, claim: "claim intro" }],
    });
    try {
      const events = await s.run();
      const lines = logSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('"event":"deep_research_page_skipped"'))
        .map((l) => JSON.parse(l));
      const noted = s.requests.filter(isNotes).map((r) => noteBlock(r)!.n);
      expect(noted).toEqual([1]); // only the long, relevant page (the first numbered page) is noted
      expect(lines.map((l) => [l.n, l.reason])).toEqual([
        [undefined, "empty"], // FR47: unreadable pages have no number
        [undefined, "blocked"],
        [2, "empty"], // FR43 no-match page keeps its number
      ]);
      expect(lines.map((l) => l.url)).toEqual([
        "https://alpha.example/1",
        "https://alpha.example/2",
        "https://beta.example/1",
      ]);
      for (const l of lines) expect(typeof l.detail).toBe("string");
      const sources = JSON.parse(events.find((e) => e.event === "sources")!.data).items as Array<{ url: string; n: number }>;
      expect(sources.map((x) => [x.n, x.url])).toEqual([
        [1, "https://alpha.example/3"],
        [2, "https://beta.example/1"],
      ]);
    } finally {
      logSpy.mockRestore();
      s.server.stop(true);
    }
  });
});
