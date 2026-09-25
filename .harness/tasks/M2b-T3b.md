TASK M2b-T3b — Live proof over the tailnet: a genuinely failed load leaves nothing resident and the app shows the reason

(Split from M2b-T3 after two interrupted invocations that persisted nothing — the open-ended part was finding a real failure to induce. This task bounds that search.)

Routing: tier Mid, model sonnet, reason_code NOT_BOUNDED
  detail: must induce a genuine Ollama load failure on the live Mac; the method is bounded below but its outcome is not known in advance.

Goal:
A repeatable live proof, through the real server at https://ryans-mac-studio.tailc3648a.ts.net:8443 and the
app's own client/helpers, that a load which genuinely fails in Ollama leaves nothing resident and the app's
view shows the failure reason (M2-AC5). The Mac is left as found.

Relevant Requirements:
- M2-AC5: A failed load, such as out of memory, leaves nothing resident and the app shows the failure reason.
FR3: /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 23-25; edge case lines 134-135.

Current state (context not obvious from the code):
- Server (committed): POST /v1/models/load {name} → 202, async; on failure GET /v1/state has
  `operation: {kind:"idle", model, error}` and `resident: null`. Reasons (server/src/models/manager.ts):
  "Not enough memory to load <name>: <ollama text>", "Model not found: <name>", "Ollama unreachable", "Load failed: <ollama text>".
  The server only accepts names listed in /api/tags (else 404), so the failing model must be installed.
- Phone side (committed): mobile/src/api/client.ts (APIClient, ServerError), mobile/src/ui/modelActions.ts
  (poll-until-idle helper), mobile/src/ui/modelList.ts (`failureMessage`, resident label).
- Pattern to copy: mobile/scripts/model-list-proof.{sh,ts} (LaunchAgent restart, wait for 401, token file
  ~/.phone-models/token, dynamic import of app modules). M2b-T3a may be adding model-swap-proof.{sh,ts}; do not edit those.
- Mac: 64 GB unified memory; installed models 14-28 GB; `devstral:24b` is normally resident with keep_alive -1
  (loaded by another tool). The previous attempts tried a probe FROM nemotron3:33b with num_ctx 131072 — outcome unknown,
  probably loads fine.

Step 1 — find the failure (bounded; do this FIRST, by direct commands, before writing the scripts):
- Record the resident model. Create a probe `m2b-failed-load-probe` FROM the largest installed model with
  `PARAMETER num_ctx N` and try `curl -s --max-time 600 127.0.0.1:11434/api/generate -d '{"model":"m2b-failed-load-probe","keep_alive":0}'`.
  Try at most three values, in order: N=2097152, N=8388608, N=33554432. The first that returns {"error": ...}
  (expected: a memory error) is the method. `ollama rm` the probe and restore the original resident model after each try.
- If none fails, STOP: restore the Mac, and return FAIL with the three observed responses — that is a human decision
  about how AC5 can be proven live, not something to keep searching for.

Step 2 — write mobile/scripts/model-failed-load-proof.sh + .ts using the found method:
- trap cleanup: `ollama rm` the probe; restore the originally resident model with keep_alive -1.
- restart com.harness.server and com.harness.bundle-host; wait for 401.
- create the probe; load it via the app client + poll helper (it must appear in /v1/state models first).
- assert: final operation.kind "idle" with non-empty error; Ollama /api/ps is empty; `resident` null;
  the view's resident label is "Nothing loaded" and `failureMessage` is non-empty and contains Ollama's reason; print it.
- exit non-zero on any failed assertion. `curl` needs `--max-time`.

Files Allowed To Change:
- mobile/scripts/model-failed-load-proof.sh (new), mobile/scripts/model-failed-load-proof.ts (new)

Constraints:
- No production code changes; a product defect is reported under Unresolved issues, not fixed.
- No hardcoded installed-model names in the scripts (derive from /api/tags); the probe name is the exception.
- Leave Ollama as found. Do not commit.
- Turn discipline: Step 1 within ~10 turns; write both files in full right after; one run to the evidence log.
  If low on turns, write .harness/tasks/M2b-T3b-handoff-1.md (what exists, what passed, the found method, live-Mac state) and return CONTINUE.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bash scripts/model-failed-load-proof.sh && bun run typecheck && bun run lint
Write complete output (including the Step 1 responses) to /Users/ryankenny/Projects/CodingHarnessv2/.harness/evidence/M2b-T3b-worker.log.

Return: the worker return contract (Summary, Files changed, Tests run, Test result, Unresolved issues).
