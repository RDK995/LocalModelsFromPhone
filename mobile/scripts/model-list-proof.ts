#!/usr/bin/env bun
/**
 * Live proof: the app's model list and resident state match live Ollama over the tailnet.
 *
 * Reads the token file, uses the app's client to call /v1/state from the server,
 * runs toModelListView, and independently fetches Ollama /api/tags and /api/ps.
 * Asserts that the app's model list matches Ollama's data.
 *
 * Env:
 *   SERVER_URL  default https://ryans-mac-studio.tailc3648a.ts.net:8443
 *   OLLAMA_URL  default http://127.0.0.1:11434
 */

// We use dynamic imports at the end to avoid TypeScript compile-time issues
// with importing the modules before parsing command-line args.

interface OllamaModel {
  name: string;
  size: number;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

interface OllamaPsProcess {
  name: string;
}

interface OllamaPsResponse {
  models: OllamaPsProcess[];
}

const SERVER_URL = process.env.SERVER_URL || "https://ryans-mac-studio.tailc3648a.ts.net:8443";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const TOKEN_FILE = process.env.PHONE_MODELS_TOKEN_FILE || `${process.env.HOME}/.phone-models/token`;

async function main() {
  try {
    // Read the token file
    const tokenBuffer = await Bun.file(TOKEN_FILE).bytes();
    const token = new TextDecoder().decode(tokenBuffer).trim();

    if (!token) {
      console.error("FAIL: token file is empty");
      process.exit(1);
    }

    // Import the modules from the app
    const { createAPIClient } = await import("../src/api/client");
    const { toModelListView, formatSize } = await import("../src/ui/modelList");

    // Create the API client and set the token
    const client = createAPIClient(SERVER_URL, fetch);
    client.setToken(token);

    // Get the state from the server
    let state;
    try {
      state = await client.getState();
    } catch (err) {
      if (err instanceof Error) {
        console.error(`FAIL: Failed to get state from server: ${err.message}`);
      } else {
        console.error(`FAIL: Failed to get state from server`);
      }
      process.exit(1);
    }

    // Get the model list view
    const modelListView = toModelListView(state);

    // Fetch Ollama tags
    let ollamaTags: OllamaTagsResponse;
    try {
      const response = await fetch(`${OLLAMA_URL}/api/tags`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      ollamaTags = await response.json();
    } catch (err) {
      if (err instanceof Error) {
        console.error(`FAIL: Failed to fetch Ollama tags: ${err.message}`);
      } else {
        console.error(`FAIL: Failed to fetch Ollama tags`);
      }
      process.exit(1);
    }

    // Fetch Ollama ps (running models)
    let ollamaPs: OllamaPsResponse;
    try {
      const response = await fetch(`${OLLAMA_URL}/api/ps`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      ollamaPs = await response.json();
    } catch (err) {
      if (err instanceof Error) {
        console.error(`FAIL: Failed to fetch Ollama ps: ${err.message}`);
      } else {
        console.error(`FAIL: Failed to fetch Ollama ps`);
      }
      process.exit(1);
    }

    let passed = 0;
    let failed = 0;

    // Check (a): row names equal the /api/tags names as a set and in order, with the same count
    const rowNames = modelListView.rows.map((r) => r.name);
    const ollamaNames = ollamaTags.models.map((m) => m.name);

    if (rowNames.length !== ollamaNames.length) {
      console.log(`FAIL (a): model count mismatch: app has ${rowNames.length}, Ollama has ${ollamaNames.length}`);
      failed++;
    } else if (!rowNames.every((name, i) => name === ollamaNames[i])) {
      console.log(`FAIL (a): model names or order mismatch`);
      console.log(`  App:   [${rowNames.join(", ")}]`);
      console.log(`  Ollama: [${ollamaNames.join(", ")}]`);
      failed++;
    } else {
      console.log(`PASS (a): model names match Ollama /api/tags (count=${rowNames.length})`);
      passed++;
    }

    // Check (b): each row's size equals formatSize(<that model's /api/tags size>)
    // and the state's size_bytes equals the /api/tags size exactly
    let sizeMismatch = false;
    for (let i = 0; i < modelListView.rows.length; i++) {
      const row = modelListView.rows[i];
      const ollamaModel = ollamaTags.models[i];

      const expectedSizeLabel = formatSize(ollamaModel.size);
      if (row.sizeLabel !== expectedSizeLabel) {
        console.log(`FAIL (b): size label mismatch for ${row.name}`);
        console.log(`  Expected: ${expectedSizeLabel}, Got: ${row.sizeLabel}`);
        sizeMismatch = true;
        break;
      }

      const stateModel = state.models.find((m: any) => m.name === row.name);
      if (!stateModel) {
        console.log(`FAIL (b): model not found in state: ${row.name}`);
        sizeMismatch = true;
        break;
      }

      if (stateModel.size_bytes !== ollamaModel.size) {
        console.log(`FAIL (b): size_bytes mismatch for ${row.name}`);
        console.log(`  Expected: ${ollamaModel.size}, Got: ${stateModel.size_bytes}`);
        sizeMismatch = true;
        break;
      }
    }

    if (!sizeMismatch) {
      console.log(`PASS (b): all model sizes match Ollama /api/tags`);
      passed++;
    } else {
      failed++;
    }

    // Check (c): residentLabel matches the resident state
    let expectedResidentLabel: string;
    if (ollamaPs.models.length > 0) {
      expectedResidentLabel = `Loaded: ${ollamaPs.models[0].name}`;
    } else {
      expectedResidentLabel = "Nothing loaded";
    }

    if (modelListView.residentLabel === expectedResidentLabel) {
      console.log(`PASS (c): resident label matches Ollama /api/ps: "${modelListView.residentLabel}"`);
      passed++;
    } else {
      console.log(`FAIL (c): resident label mismatch`);
      console.log(`  Expected: "${expectedResidentLabel}"`);
      console.log(`  Got:      "${modelListView.residentLabel}"`);
      failed++;
    }

    // Print summary
    console.log("");
    console.log(`Models: [${ollamaNames.join(", ")}]`);
    console.log(`Sizes:  [${ollamaTags.models.map((m) => `${m.name}=${formatSize(m.size)}`).join(", ")}]`);
    console.log("");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error(`FAIL: Unexpected error: ${err.message}`);
    } else {
      console.error(`FAIL: Unexpected error`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FAIL: Fatal error", err);
  process.exit(1);
});
