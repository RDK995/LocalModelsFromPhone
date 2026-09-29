/**
 * Runs the search helper subprocess (interface I17) once per request.
 * The command is an argv array (never a shell string); the query is a single argv element.
 */
import { join } from "node:path";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type HelperOutcome =
  | { ok: true; results: SearchResult[]; backend: string }
  | { ok: false; detail: string };

export interface HelperOptions {
  /** Command prefix; `--query <q> --max <n>` is appended. Defaults to the venv python + search.py. */
  command?: string[];
}

const SEARCH_DIR = join(import.meta.dir, "..", "..");
const DEFAULT_COMMAND = [join(SEARCH_DIR, "helper", ".venv", "bin", "python"), join(SEARCH_DIR, "helper", "search.py")];

export async function runHelper(
  query: string,
  max: number,
  signal: AbortSignal,
  options: HelperOptions = {},
): Promise<HelperOutcome> {
  const argv = [...(options.command ?? DEFAULT_COMMAND), "--query", query, "--max", String(max)];
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  } catch {
    return { ok: false, detail: "helper could not be started" };
  }
  const kill = () => {
    try {
      proc.kill();
    } catch {
      // already exited
    }
  };
  if (signal.aborted) kill();
  else signal.addEventListener("abort", kill, { once: true });

  try {
    const [text, code] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), proc.exited]);
    if (code !== 0) return { ok: false, detail: `helper exited with code ${code}` };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, detail: "helper produced invalid output" };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, detail: "helper produced invalid output" };
    }
    const obj = parsed as Record<string, unknown>;
    if ("error" in obj) {
      return { ok: false, detail: typeof obj.detail === "string" ? obj.detail : String(obj.error) };
    }
    if (!Array.isArray(obj.results) || typeof obj.backend !== "string") {
      return { ok: false, detail: "helper produced invalid output" };
    }
    const results: SearchResult[] = [];
    for (const r of obj.results as unknown[]) {
      if (typeof r !== "object" || r === null) continue;
      const e = r as Record<string, unknown>;
      if (typeof e.url !== "string" || e.url === "") continue;
      results.push({
        title: typeof e.title === "string" ? e.title : "",
        url: e.url,
        snippet: typeof e.snippet === "string" ? e.snippet : "",
      });
      if (results.length >= max) break;
    }
    return { ok: true, results, backend: obj.backend };
  } finally {
    signal.removeEventListener("abort", kill);
  }
}
