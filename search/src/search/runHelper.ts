/**
 * Runs the search helper subprocess (interface I17) once per request.
 * The command is an argv array (never a shell string); the query is a single argv element.
 * The helper runs in its own process group so that on timeout, client abort, or after it exits,
 * the whole group (helper + Playwright driver + Chromium) is SIGKILLed together.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type HelperOutcome =
  | { ok: true; results: SearchResult[]; backend: string }
  | { ok: false; detail: string; timeout?: true };

export interface HelperOptions {
  /** Command prefix; `--query <q> --max <n>` is appended. Defaults to the venv python + search.py. */
  command?: string[];
  /** Time limit for the whole helper run, in ms. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 25_000;

const SEARCH_DIR = join(import.meta.dir, "..", "..");
const DEFAULT_COMMAND = [join(SEARCH_DIR, "helper", ".venv", "bin", "python"), join(SEARCH_DIR, "helper", "search.py")];

export async function runHelper(
  query: string,
  max: number,
  signal: AbortSignal,
  options: HelperOptions = {},
): Promise<HelperOutcome> {
  const argv = [...(options.command ?? DEFAULT_COMMAND), "--query", query, "--max", String(max)];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let proc: ChildProcess;
  try {
    // detached: the helper leads a new session/process group, so -pid addresses all its descendants.
    proc = spawn(argv[0]!, argv.slice(1), { stdio: ["ignore", "pipe", "ignore"], detached: true });
  } catch {
    return { ok: false, detail: "helper could not be started" };
  }
  const pid = proc.pid;
  const killGroup = () => {
    if (pid === undefined) return;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // ESRCH: the group is already gone
    }
  };

  let text = "";
  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (chunk: string) => {
    text += chunk;
  });
  const stdoutClosed = new Promise<void>((resolve) => {
    proc.stdout!.once("close", resolve);
    proc.stdout!.once("error", () => resolve());
  });
  // Resolves with the exit code, or null if the helper could not be started / was killed by a signal.
  const exited = new Promise<number | null>((resolve) => {
    proc.once("exit", (code) => resolve(code));
    proc.once("error", () => resolve(null));
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  let onAbort = () => {};
  const aborted = new Promise<"aborted">((resolve) => {
    onAbort = () => resolve("aborted");
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    const first = await Promise.race([exited, timedOut, aborted]);
    if (first === "timeout" || first === "aborted") {
      killGroup();
      return first === "timeout"
        ? { ok: false, detail: "helper timed out", timeout: true }
        : { ok: false, detail: "request aborted" };
    }
    // The helper exited; kill anything it left behind so stdout can close and nothing lingers.
    killGroup();
    if (first === null) {
      return { ok: false, detail: pid === undefined ? "helper could not be started" : "helper was killed" };
    }
    if ((await Promise.race([stdoutClosed, timedOut])) === "timeout") {
      return { ok: false, detail: "helper timed out", timeout: true };
    }
    const code = first;
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
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
