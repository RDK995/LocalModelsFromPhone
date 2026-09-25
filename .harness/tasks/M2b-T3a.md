TASK M2b-T3a — Live proof over the tailnet: swap, unload, stays resident (10 min idle + after a chat reply)

(Split from M2b-T3 after two interrupted invocations that persisted nothing; the failed-load part (M2-AC5) moved to M2b-T3b so this task has no failure-induction search.)

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: live proof script with stated assertions and side effects on the Mac (evicts and restores the resident model).

Goal:
A repeatable live proof, using the app's own client and helpers against the real server at
https://ryans-mac-studio.tailc3648a.ts.net:8443 and the real Ollama at http://127.0.0.1:11434,
that demonstrates M2-AC2 and M2-AC3 and leaves the Mac as it found it.

Relevant Requirements:
.harness/milestones.md section "M2b" acceptance criteria:
- M2-AC2: Loading model A then model B leaves only B resident in GET /api/ps; unloading leaves nothing resident.
- M2-AC3: A model loaded from the phone remains resident in GET /api/ps after 10 minutes idle and after a chat reply completes.
FR3-FR5: /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 23-29; edge case lines 134-135.

Current state (context not obvious from the code):
- Tasks M2b-T1 (server) and M2b-T2 (phone) are committed. The server implements
  POST /v1/models/load {name} / POST /v1/models/unload (202, async) and reports progress and
  failures in GET /v1/state `operation` ({kind:"idle", model, error} after a failed load).
  The phone side has `ServerError` in mobile/src/api/client.ts, a poll-until-idle helper in
  mobile/src/ui/modelActions.ts, and view-model fields in mobile/src/ui/modelList.ts (read them).
- The live server runs from this working tree under LaunchAgent `com.harness.server`; it must be
  restarted (`launchctl kickstart -k gui/$(id -u)/com.harness.server`, and likewise
  `com.harness.bundle-host`) to pick up the new code, then wait for 401 on /v1/state — copy the
  pattern from mobile/scripts/model-list-proof.sh. The token is in ~/.phone-models/token.
- Follow mobile/scripts/model-list-proof.{sh,ts}: a .sh wrapper plus a bun .ts script that imports
  the app's own modules (`../src/api/client`, `../src/ui/modelActions`, `../src/ui/modelList`).
- The Mac has 64 GB unified memory. Installed models are ~14-28 GB. Another tool currently keeps
  a model resident with keep_alive -1; the proof necessarily evicts it, so it must record what
  was resident at the start and restore it at the end (POST /api/generate {model, keep_alive:-1}
  directly to Ollama), including when the proof fails (trap).
- Derive A and B from /api/tags (e.g. the two smallest); do not hardcode model names.

Acceptance Criteria (the proof script must assert each and exit non-zero on any failure):
1. Via the app client + helper: load A → wait idle → Ollama /api/ps lists exactly [A]; the view's
   resident label is "Loaded: A" and `loaded_by_server` is true.
2. Load B → wait idle → /api/ps lists exactly [B] (M2-AC2 swap).
3. Send one short chat to B via POST /v1/chat through the app client, wait for the terminal
   `done` event → /api/ps still lists exactly [B] and its `expires_at` is far in the future
   (year ≥ 2100), i.e. keep_alive -1 was not reset (M2-AC3, after a chat reply).
4. Idle `IDLE_SECONDS` (default 600, overridable by env for a quick run) with no requests to
   Ollama from the proof in between → /api/ps still lists exactly [B] (M2-AC3, 10 minutes idle).
   The final evidence run must use the default 600.
5. Unload via the app → wait idle → /api/ps is empty; view label "Nothing loaded" (M2-AC2 unload).
6. Cleanup: the originally resident model (if any) is resident again. Print before/after /api/ps.
- Each step prints the observed /api/ps JSON names and the view labels, so the log is evidence.

Relevant Files:
- mobile/scripts/model-list-proof.sh, mobile/scripts/model-list-proof.ts (pattern)
- mobile/src/api/client.ts, mobile/src/ui/modelActions.ts, mobile/src/ui/modelList.ts
- server/src/models/manager.ts (reason wording)

Files Allowed To Change:
- mobile/scripts/model-swap-proof.sh (new), mobile/scripts/model-swap-proof.ts (new)

Constraints:
- No production code changes. If the proof reveals a product defect, stop and report it under
  Unresolved issues with the evidence — do not fix it here.
- No hardcoded model names in the scripts (derive from /api/tags).
- Leave Ollama as found (trap-based cleanup). Do not touch other LaunchAgents. Do not commit.
- `curl` calls need `--max-time`.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bash scripts/model-swap-proof.sh && bun run typecheck && bun run lint
(The full run takes a little over 10 minutes because of the idle wait; use a Bash timeout of at least 1200000 ms.)
Write complete output to /Users/ryankenny/Projects/CodingHarnessv2/.harness/evidence/M2b-T3a-worker.log.

Return: the worker return contract (Summary, Files changed, Tests run, Test result, Unresolved issues).

Turn discipline: write both script files in full within your first ~8 turns (copy the structure of model-list-proof.{sh,ts}); one quick run with IDLE_SECONDS=5; then exactly one final run with the default 600 tee'd to the evidence log. If low on turns, write .harness/tasks/M2b-T3a-handoff-1.md (what exists, what passed, what remains, live-Mac state) and return CONTINUE.
