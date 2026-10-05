// Parses a captured POST /v1/chat SSE stream from a deep research run.
import { readFileSync } from "node:fs";

const raw = readFileSync(process.argv[2], "utf8");
const events: { type: string; data: any }[] = [];
for (const block of raw.split(/\n\n/)) {
  let type = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) type = line.slice(7);
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (type && data) {
    try {
      events.push({ type, data: JSON.parse(data) });
    } catch {
      /* skip unparseable */
    }
  }
}

const done = events.filter((e) => e.type === "done").pop();
const content = events.filter((e) => e.type === "content").map((e) => e.data.text ?? "").join("");
const sources: { n: number; url: string; title: string }[] =
  events.filter((e) => e.type === "sources").pop()?.data.items ?? [];
const readUrls = new Set(
  events.filter((e) => e.type === "step" && e.data.kind === "read" && e.data.status === "done").map((e) => e.data.url)
);

const cited = new Set<number>();
for (const m of content.matchAll(/\[(\d+)\]/g)) cited.add(Number(m[1]));
const sourceNs = new Set(sources.map((s) => s.n));
const unresolved = [...cited].filter((n) => !sourceNs.has(n)).sort((a, b) => a - b);
const citedReadPages = sources.filter((s) => cited.has(s.n) && readUrls.has(s.url)).length;

console.log(
  JSON.stringify(
    {
      final_status: done?.data.status ?? null,
      event_counts: events.reduce((a: Record<string, number>, e) => ((a[e.type] = (a[e.type] ?? 0) + 1), a), {}),
      report_chars: content.length,
      source_count: sources.length,
      citation_numbers: [...cited].sort((a, b) => a - b),
      unresolved_citations: unresolved,
      cited_read_pages: citedReadPages,
      read_pages_total: readUrls.size,
    },
    null,
    2
  )
);
