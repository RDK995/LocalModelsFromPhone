/**
 * Server entry point.
 *
 * Reads the bearer token from the token file written by the ops token command
 * (default ~/.phone-models/token, mode 0600), refuses to start if the file is
 * missing, empty, not a regular file, or group/world-readable, then starts the
 * HTTP server on 127.0.0.1:7789 in front of Ollama at 127.0.0.1:11434.
 *
 * Server setting:
 *   PHONE_MODELS_RESEARCH_BUDGET_MS - deep research time budget in milliseconds
 *                            (positive integer; absent or invalid -> the 480000 default)
 *   PHONE_MODELS_RESEARCH_MODEL - the one model deep research runs on (FR34); GET /v1/state
 *                            reports it and deep research is refused unless it is loaded
 *                            (trimmed; absent or blank -> qwen3.5:35b-a3b)
 *
 * Test-only overrides (never set these in the LaunchAgent):
 *   PHONE_MODELS_PORT        - listen port (loopback host is not overridable)
 *   PHONE_MODELS_TOKEN_FILE  - token file path
 *   PHONE_MODELS_OLLAMA_URL  - Ollama base URL (default http://127.0.0.1:11434)
 *   PHONE_MODELS_SEARCH_URL  - search service base URL (default http://127.0.0.1:7790)
 */

import { readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { GenerationManager } from "./generations/manager";
import { createServer, DEFAULT_RESEARCH_MODEL, setValidToken } from "./http/server";
import { OllamaClient } from "./ollama/client";
import { createWebTools } from "./web/tools";

const LISTEN_HOST = "127.0.0.1";
const OLLAMA_URL = "http://127.0.0.1:11434";
const SEARCH_URL = "http://127.0.0.1:7790";
const DEFAULT_PORT = 7789;
export const DEFAULT_TOKEN_FILE = join(homedir(), ".phone-models", "token");

/**
 * Read the bearer token, enforcing the same rule as the ops token command:
 * a group- or world-readable file is refused.
 * @throws {Error} if the file is missing, unsafe, or empty
 */
export function readTokenFile(filePath: string): string {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    throw new Error(
      `Token file "${filePath}" not found; create it with the ops token command`
    );
  }
  if (!stats.isFile()) {
    throw new Error(`Token file "${filePath}" is not a regular file`);
  }
  if ((stats.mode & 0o044) !== 0) {
    throw new Error(
      `Token file "${filePath}" is group or world-readable (mode ${(stats.mode & 0o777).toString(8)}); it must be 0600`
    );
  }
  const token = readFileSync(filePath, "utf-8").trim();
  if (!token) {
    throw new Error(`Token file "${filePath}" is empty`);
  }
  return token;
}

function parsePortOverride(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PHONE_MODELS_PORT must be an integer 1-65535, got "${value}"`);
  }
  return port;
}

export { DEFAULT_RESEARCH_MODEL };

export function parseResearchModel(value: string | undefined): string {
  const name = value?.trim();
  return name ? name : DEFAULT_RESEARCH_MODEL;
}

export function parseResearchBudget(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9]\d*$/.test(value.trim())) return undefined;
  const ms = Number(value.trim());
  return Number.isSafeInteger(ms) ? ms : undefined;
}

export function main(env: Record<string, string | undefined> = process.env): void {
  const tokenFile = env.PHONE_MODELS_TOKEN_FILE || DEFAULT_TOKEN_FILE;
  const port = parsePortOverride(env.PHONE_MODELS_PORT) ?? DEFAULT_PORT;

  setValidToken(readTokenFile(tokenFile));

  const ollama = new OllamaClient(env.PHONE_MODELS_OLLAMA_URL || OLLAMA_URL);
  const webTools = createWebTools({ baseUrl: env.PHONE_MODELS_SEARCH_URL || SEARCH_URL });
  const budgetMs = parseResearchBudget(env.PHONE_MODELS_RESEARCH_BUDGET_MS);
  const manager = new GenerationManager(ollama, webTools, budgetMs === undefined ? {} : { budgetMs });
  const server = createServer({
    ollama,
    manager,
    port,
    icon: webTools.icon,
    researchModel: parseResearchModel(env.PHONE_MODELS_RESEARCH_MODEL),
  });

  if (server.hostname !== LISTEN_HOST) {
    server.stop(true);
    throw new Error(
      `Refusing to run: server bound to ${server.hostname}, expected ${LISTEN_HOST}`
    );
  }

  console.log(`phone-models server listening on http://${server.hostname}:${server.port}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
