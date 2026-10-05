TASK M4a-T5 — Live proof over the tailnet: a thinking-capable model's reasoning arrives as `thinking` events separate from the answer and is stored separately by the app's own send path; a non-thinking model still replies normally

Routing: tier Cheap, model haiku, reason_code BOUNDED_LOW_RISK
  detail: a proof script in the established mobile/scripts/*-proof.{sh,ts} pattern over already-built modules against the live server; the script's own assertions are the oracle.

Goal:
A live proof script mobile/scripts/thinking-proof.{sh,ts}, modelled on
mobile/scripts/conversation-proof.{sh,ts} (read both first and reuse their token reading,
restart/wait/restore trap, swap-load and poll helpers), that drives the app's own code
(mobile/src/chat/conversationSession.ts `sendInConversation`, the conversation store over the
file-backed StoragePort in mobile/src/store/fileStorage.ts, and mobile/src/api/client.ts) against
the real server at https://ryans-mac-studio.tailc3648a.ts.net:8443 and asserts:

1. Pick models from Ollama directly: for each installed model (`GET http://127.0.0.1:11434/api/tags`)
   call `POST http://127.0.0.1:11434/api/show {model}` and read `capabilities`. T = the smallest
   installed model whose capabilities include "thinking"; N = the smallest one whose capabilities do
   not include "thinking" (and do include "completion"). Print both. If no thinking-capable model is
   installed, print FAIL with that reason and exit non-zero (do not skip silently).
2. Thinking (M4-AC1): swap-load T (confirm: true, poll until idle). In a new conversation, send
   "What is 17 + 25? Answer with just the number." through `sendInConversation`, wrapping the
   client's `chat` so every StreamEvent the session sees is recorded. Assert: at least one
   `thinking` event with non-empty text; at least one `content` event; the first `thinking` event
   arrives before the first `content` event; terminal `done` with status "complete". Then read the
   conversation back from the store and assert the assistant message has non-empty `thinking` AND
   non-empty `content`, `content` contains "42", and `content` does not contain the full thinking
   text (i.e. they are stored separately). Print the first 200 characters of each.
3. Non-thinking model unaffected: swap-load N, send "Reply with just OK." in a new conversation.
   Assert zero `thinking` events, non-empty content, `done` status "complete", stored message has no
   `thinking` field.

The shell wrapper restarts com.harness.server (so the server running this branch's code is the one
tested) and com.harness.bundle-host, waits for 401 on /v1/state, records what was resident before,
and restores it (or nothing) via a trap on any exit — copy the pattern from conversation-proof.sh.
Print a clear PASS/FAIL line per numbered check and exit non-zero on any failure.

Relevant Requirements:
FR10 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 45-46.
Milestone criterion M4-AC1 — .harness/milestones.md "## M4a".

Context not obvious from the code:
- The server (committed in M4a-T1) now calls Ollama /api/show and sends `think: true` only for
  models whose capabilities include "thinking", and emits `thinking {text}` SSE events before the
  same chunk's `content`. The phone client already parses `thinking` events; the session already
  stores `thinking` on the assistant message.
- Model replies are nondeterministic; one retry of a send is acceptable and must be reported.
- The screen-side collapsed rendering is covered by other tasks; this script proves the data path.

Acceptance Criteria:
- mobile/scripts/thinking-proof.sh and mobile/scripts/thinking-proof.ts exist, follow the pattern
  above, and `bash scripts/thinking-proof.sh` exits 0 with all three checks PASS.
- Save the full output of one run to .harness/evidence/M4a-T5-worker.log.
- `bun run typecheck` and `bun run lint` still pass.

Relevant Files:
- mobile/scripts/conversation-proof.sh, mobile/scripts/conversation-proof.ts (pattern)
- mobile/src/chat/conversationSession.ts, mobile/src/store/, mobile/src/api/client.ts

Files Allowed To Change:
- mobile/scripts/thinking-proof.sh (new)
- mobile/scripts/thinking-proof.ts (new)

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. No new dependencies.
- Do not change shared/, server/, mobile/src/. Another worker is concurrently editing
  mobile/src/app/chat.tsx; do not touch it.
- Run nothing else against the Mac at the same time; always restore the resident model.
- Do not weaken tests. No git stash, no commits (the orchestrator commits).

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun run lint && bash scripts/thinking-proof.sh

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
