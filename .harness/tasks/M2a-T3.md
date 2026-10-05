TASK M2a-T3 — Live proof: the app's model list and resident state match live Ollama over the tailnet

Routing: tier Cheap, model haiku, reason_code BOUNDED_LOW_RISK
  detail: a proof script with a stated pass condition plus restarting two existing LaunchAgents; settled by one command's exit status.

Goal:
Prove M2-AC1 (and the FR2 resident/nothing-loaded display) against the live Mac Studio: the
running server (restarted onto the current commit) serves /v1/state through Tailscale Serve, and
the app's own client + view-model turn it into a list that equals Ollama `GET /api/tags` by name
and size, with the true resident model or "Nothing loaded".

Relevant Requirements:
FR1, FR2; acceptance criterion M2-AC1 "The app's model list matches Ollama GET /api/tags by real
name and size, with no hardcoded model names." — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md
lines 17-21 and 76-77 ("All proven against the live Mac Studio and Ollama, not mocks").

Context (decided in earlier tasks of this milestone, already committed):
- Server: `server/src/models/manager.ts` (ModelManager.state()) backs `GET /v1/state`.
- App: `mobile/src/ui/modelList.ts` exports `toModelListView(state)` → `{rows:[{name,sizeLabel,isResident}], residentLabel}`
  and `formatSize(bytes)`; `mobile/src/api/client.ts` exports `createAPIClient(baseUrl, fetchImpl)`
  whose `getState()` calls GET /v1/state with the bearer token.
- Live endpoints: app-facing `https://ryans-mac-studio.tailc3648a.ts.net:8443`; Ollama
  `http://127.0.0.1:11434`; token file `~/.phone-models/token` (never print the token).
- LaunchAgents (user domain): `com.harness.server` (runs `bun src/index.ts` in server/) and
  `com.harness.bundle-host` (Expo production bundle host for the phone on :8081).

Acceptance Criteria:
1. Restart both LaunchAgents onto the current code with
   `launchctl kickstart -k gui/$(id -u)/com.harness.server` and
   `launchctl kickstart -k gui/$(id -u)/com.harness.bundle-host`; wait until
   `curl -s -o /dev/null -w '%{http_code}' https://ryans-mac-studio.tailc3648a.ts.net:8443/v1/state`
   returns 401 (up, auth enforced). No sudo; do not touch Tailscale Serve config or pf.
2. New `mobile/scripts/model-list-proof.ts` (run with `bun`, from mobile/): reads the token
   file, builds the app's client with `createAPIClient("https://ryans-mac-studio.tailc3648a.ts.net:8443", fetch)`,
   calls `getState()`, runs `toModelListView`, independently fetches Ollama
   `http://127.0.0.1:11434/api/tags` and `/api/ps`, and asserts:
   (a) row names equal the /api/tags names as a set and in order, with the same count;
   (b) each row's size equals `formatSize(<that model's /api/tags size>)` and the state's
       `size_bytes` equals the /api/tags `size` exactly;
   (c) `residentLabel` is `"Loaded: <first /api/ps name>"` when /api/ps is non-empty, else
       `"Nothing loaded"`.
   It prints a PASS/FAIL line per check plus the model names and sizes (never the token) and exits
   non-zero on any failure.
3. New `mobile/scripts/model-list-proof.sh` wrapper that runs the .ts once as-is, then, ONLY if
   /api/ps was empty at start: loads the smallest installed model directly through Ollama as
   "another tool" would (`curl -s http://127.0.0.1:11434/api/generate -d '{"model":"<name>","keep_alive":"5m"}'`,
   name chosen at runtime from /api/tags — no hardcoded names), re-runs the .ts (which must now
   report `Loaded: <that name>`), then unloads it (`keep_alive:0`), waits until /api/ps is empty,
   and re-runs the .ts once more (must report `Nothing loaded`). If something was already
   resident at start, it skips the load/unload and says so. Exits non-zero if any run fails.
   It must leave Ollama's resident set as it found it.
4. A static check in the wrapper: `grep` for every current /api/tags model name across
   `mobile/src` and `server/src` non-test source, failing if any is found (proves no hardcoded
   names).

Relevant Files:
- mobile/src/api/client.ts, mobile/src/ui/modelList.ts, shared/api.ts (read only)
- server/scripts/curl-chat-stream-proof.sh (existing live-proof script style)
- ops/scripts/com.harness.server.plist, ops/scripts/com.harness.bundle-host.plist (read only)

Files Allowed To Change:
- mobile/scripts/model-list-proof.ts (new), mobile/scripts/model-list-proof.sh (new, executable)

Constraints:
- No sudo, no Tailscale/pf changes, no edits outside the two new files. Do not weaken tests.
- If mobile tsconfig/lint rejects a file under scripts/, keep it out of `src` so lint is unaffected;
  make sure `cd mobile && bun run typecheck && bun run lint` still exits 0.
- Do not commit.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bash scripts/model-list-proof.sh && bun run typecheck && bun run lint
Write complete output to /Users/ryankenny/Projects/CodingHarnessv2/.harness/evidence/M2a-T3-worker.log.

Return: the worker return contract (Summary, Files changed, Tests run, Test result, Unresolved issues).
