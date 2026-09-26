TASK M5b-T2 — Live proof: each of the six failure modes, induced for real, yields its own message

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: live-environment proof script modelled on existing mobile/scripts/*-proof.sh; needs
  judgement to induce Ollama-down and server-unreachable safely and restore every service.
Depends on: M5b-T1 (accepted; errorMessages.ts and UnreachableError exist).

Goal:
A script that, against the LIVE Mac Studio server over the tailnet and the live Ollama, induces each
of the six failure modes and asserts that the app's own client (mobile/src/api/client.ts) plus
mapping (mobile/src/api/errorMessages.ts `describeError` / `describeOperationFailure`, and
mobile/src/ui/modelList.ts `toModelListView(...).failureMessage` for load failures) produce the
exact expected sentence for each, and that the six observed sentences are pairwise distinct.

Relevant Requirements:
- FR16 / M5-AC3 (.harness/requirements.md line 65). Requirements line 74: "All proven against the
  live Mac Studio and Ollama, not mocks."

Acceptance Criteria (each scenario prints `PASS <scenario>: <observed sentence>` or fails):
1. wrong password — client with a bogus token; `getState()` → describeError === UNAUTHORIZED_MESSAGE.
2. model no longer installed — `ollama cp <smallest model from /api/tags> m5b-gone-probe`;
   `getState()` lists it; `ollama rm m5b-gone-probe`; `loadModel("m5b-gone-probe")` →
   describeError(err, "m5b-gone-probe") === notInstalledMessage("m5b-gone-probe").
3. model failed to load — reuse the proven method in mobile/scripts/model-failed-load-proof.sh
   (mismatched LoRA ADAPTER probe; read its header comment) to make a load genuinely fail; poll
   `getState()` until idle; `toModelListView(state).failureMessage` === loadFailedMessage(probe)
   and `state.operation.error_code === "load_failed"`.
4. reply already in progress — ensure a model is resident (load the smallest if none); start a
   long reply via `chat`; while it streams, a second `chat` → describeError ===
   REPLY_IN_PROGRESS_MESSAGE; then cancel the first generation.
5. Ollama down — stop Ollama (find how it runs on this Mac: app, brew service or LaunchAgent; use
   the matching stop/start), `getState()` → describeError === OLLAMA_DOWN_MESSAGE; restart Ollama
   and wait until /api/tags answers.
6. Mac/server unreachable — stop the live server with
   `launchctl bootout gui/$(id -u)/com.harness.server` (it has restart-on-exit, so kill is not
   enough; find its plist under ~/Library/LaunchAgents), `getState()` over the tailnet URL →
   describeError === UNREACHABLE_MESSAGE; then `launchctl bootstrap gui/$(id -u) <plist>` and wait
   for 401 on /v1/state.
7. All six observed sentences are pairwise distinct; script exits 0 only if all pass.
8. Restoration on ANY exit (trap): server LaunchAgent loaded and answering 401; Ollama running;
   probes `m5b-gone-probe` and the failed-load probe removed, no new blobs left; scratch dir
   deleted; the originally resident model(s) restored with keep_alive -1 (as the existing proof does).

Relevant Files:
- mobile/scripts/model-failed-load-proof.sh + .ts (template: structure, trap/restore, probe build)
- mobile/scripts/model-swap-proof.ts, mobile/scripts/resume-proof.ts (client construction patterns;
  use `new APIClient(SERVER_URL, fetchImpl, ...)` or createAPIClient as those scripts do)
- mobile/src/api/errorMessages.ts, mobile/src/api/client.ts, mobile/src/ui/modelList.ts (read only)
- Token: ~/.phone-models/token

Files Allowed To Change:
- mobile/scripts/error-messages-proof.sh (new)
- mobile/scripts/error-messages-proof.ts (new)

Constraints:
- Do not change mobile/src, server/ or shared/. If a scenario shows a product defect (e.g. a
  network failure not surfacing as UnreachableError), do not bend the assertion: return FAIL with
  the evidence.
- Never reboot the Mac, never use sudo. Every live service must be restored and running at the end.
- Script must pass `bun run typecheck` and `bun run lint` in mobile/.
- Never git stash, commit, or push.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun run lint && bash scripts/error-messages-proof.sh
Save full output to .harness/evidence/M5b-T2-worker.log. After it, confirm services: 401 from
https://ryans-mac-studio.tailc3648a.ts.net:8443/v1/state and 200 from http://127.0.0.1:11434/api/tags.
If you near your turn limit, return CONTINUE with a handoff at .harness/tasks/M5b-T2-handoff-1.md
(and make sure services are restored before returning).

Return:
- Summary (each scenario's observed sentence; how Ollama was stopped/started; services restored)
- Files changed
- Tests run
- Test result (with exit status)
- Unresolved issues
