TASK M4b-T2 — Live proof over the tailnet: killing the connection mid-reply and reconnecting yields the complete reply with no gaps and no duplicated text

Routing: tier Cheap, model haiku, reason_code BOUNDED_LOW_RISK
  detail: a proof script in the established mobile/scripts/*-proof.{sh,ts} pattern over already-built modules against the live server; the script's own assertions (compared with an independent full replay from the server) are the oracle.

Goal:
A live proof script mobile/scripts/resume-proof.{sh,ts}, modelled on
mobile/scripts/thinking-proof.{sh,ts} (read both first and reuse their token reading,
LaunchAgent restart / wait-for-401 / restore-original-resident-model trap, model selection via
Ollama /api/tags + /api/show, swap-load and poll helpers), that drives the app's own code
(`sendInConversation` in mobile/src/chat/conversationSession.ts, the conversation store over the
file-backed StoragePort in mobile/src/store/fileStorage.ts, and `APIClient` in
mobile/src/api/client.ts, which as of task M4b-T1 resumes across drops) against the real server at
https://ryans-mac-studio.tailc3648a.ts.net:8443 and asserts M4-AC2.

Relevant Requirements:
M4-AC2: "Killing the connection mid-reply and reconnecting yields the complete reply with no gaps
and no duplicated text." FR11 (.harness/requirements.md lines 47-50).

Acceptance Criteria (the script prints PASS/FAIL per check and exits non-zero on any FAIL):
1. Model: N = the smallest installed model whose /api/show capabilities include "completion" and
   do not include "thinking" (same selection code as thinking-proof.ts). Print it. Swap-load it
   (confirm: true, poll GET /v1/state until the operation is idle and N is resident).
2. Kill the connection: construct the APIClient with a wrapping fetchImpl around the real fetch.
   For the FIRST `POST /v1/chat` only, the wrapper uses its own AbortController (also aborted if the
   caller's init.signal aborts) for the real request, and returns a Response (same status and
   headers, including x-generation-id) whose body is a ReadableStream that forwards the real body's
   chunks and, once the forwarded bytes contain K=5 complete `event: content` SSE events, aborts the
   real request (closing the real HTTP connection to the server) and errors the returned stream
   with `new TypeError("simulated network drop")`. Forward nothing after the kill. Record every
   request the wrapper sees (method, URL, the Last-Event-ID header if any).
3. Send, in a new conversation via `sendInConversation`, the prompt
   "Count from 1 to 80 as digits separated by commas and spaces. Output only the numbers."
   and record every StreamEvent the session's onEvent sees, in order.
4. Assertions:
   a. the kill happened: exactly K content events had been forwarded when the kill fired, and no
      `done` event had been forwarded before it;
   b. at least one `GET /v1/generations/<genId>/events` request was made, where <genId> is the
      x-generation-id of the chat, and its Last-Event-ID header matches /^<genId>-\d+$/;
   c. exactly one `done` event was seen, with status "complete", and onComplete (not onError) ran;
   d. independent oracle: after completion, fetch `GET /v1/generations/<genId>/events` with plain
      fetch (bearer token, NO Last-Event-ID) and parse every event; expected = concatenation of all
      `content` texts in that full replay. Assert the concatenation of the session's recorded
      content event texts === expected (no gaps, no duplicates) and that the recorded content event
      count equals the replay's content event count;
   e. the stored conversation's assistant message has content === expected and status "complete";
   f. expected contains "80" (the reply really did run past the kill point). Print the first 200
      characters of the reply and the counts.
5. The .sh wrapper restores the originally resident model (or nothing resident) on every exit
   path, exactly like thinking-proof.sh, and prints a final PASS/FAIL line.

Relevant Files:
- mobile/scripts/thinking-proof.sh, mobile/scripts/thinking-proof.ts (pattern to copy)
- mobile/scripts/conversation-proof.ts (store/session wiring)
- mobile/src/api/client.ts (APIClient constructor, FetchImpl type)
- mobile/src/chat/conversationSession.ts
- mobile/package.json (read only; do not add scripts)

Files Allowed To Change:
- mobile/scripts/resume-proof.sh (new)
- mobile/scripts/resume-proof.ts (new)

Constraints:
- Follow existing repository patterns.
- Do not change unrelated behaviour; do not modify mobile/src, the server, or other scripts.
- Do not introduce dependencies.
- Do not weaken tests.
- Run nothing else against the Mac concurrently; the proof restarts com.harness.server and
  com.harness.bundle-host.
- Do not use git stash, and do not commit (the orchestrator commits).

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun run lint && bash scripts/resume-proof.sh

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
