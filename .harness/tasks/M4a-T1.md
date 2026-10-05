TASK M4a-T1 — Server asks Ollama for reasoning output when the model supports it, and streams it as `thinking` SSE events separate from `content`

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: ordinary feature work across the Ollama client (C7) and generation manager (C6) with unit tests as the oracle; no concurrency or lifecycle change.

Goal:
Today the server never requests reasoning output: server/src/ollama/client.ts `chat()` sends
`{model, messages, keep_alive:-1, stream:true}` and server/src/generations/manager.ts only turns
`chunk.message.content` into `content` SSE events. The agreed architecture (.harness/architecture.md
"Interfaces", I9/I10) says `chat(model, messages, signal)` = streamed `POST /api/chat {keep_alive:-1,
think:true when supported}`, and the SSE event set already includes `thinking {text}`
(shared/api.ts `ThinkingEvent`; the phone client already parses it).

Make it so:
1. `chat()` sends `think: true` in the /api/chat body **only when the model supports thinking**,
   and sends no `think` field otherwise (Ollama answers 400 "does not support thinking" if
   `think:true` is sent to a model without that capability — a reply to a non-thinking model must
   keep working exactly as before).
   Decide support from Ollama's `POST /api/show {model}` response: its `capabilities` array
   contains `"thinking"` for models that support it. Add a `show`/capabilities call to the Ollama
   client (same base URL, same error style as the existing calls) and cache the answer per model
   name in memory for the life of the process. If /api/show fails or has no `capabilities`, treat
   the model as not supporting thinking (never fail the chat because of it).
2. `OllamaChatResponse.message` gains optional `thinking?: string`. In the generation manager, a
   chunk whose `message.thinking` is a non-empty string appends a `thinking` event
   `{text: <that string>}` (JSON, same `append(record, ...)` path as content, so it gets a seq and is
   replayed by `GET /v1/generations/{id}/events` like any other event). A chunk may carry both;
   emit `thinking` before `content` for that chunk. Content handling, done/error, eval_count and
   tokens_per_second are unchanged (thinking chunks do not count as content chunks).
3. Update the doc comment on `chat()` that currently says "nothing else from the caller reaches
   Ollama" so it states exactly what is sent (think is decided by the server from /api/show, never
   from the caller).

Relevant Requirements:
FR10 — /Users/ryankenny/Projects/CodingHarnessv2/.harness/requirements.md lines 45-46.
Milestone criterion M4-AC1 — .harness/milestones.md "## M4a".
Architecture: .harness/architecture.md "## Interfaces" (I9/I10 and the SSE event list).

Context not obvious from the code:
- The request body is deliberately built explicitly (no spreading caller input into it). Keep that:
  add `think: true` explicitly, conditionally.
- Existing tests that assert the exact /api/chat body must keep asserting the exact body; for a
  model without the thinking capability it is unchanged. Add new tests rather than loosening old
  ones. Tests use fake fetch — follow the existing patterns in server/src/ollama/client.test.ts and
  server/src/generations/manager.test.ts.
- The generation manager's type for event kinds (manager.ts line ~18, `"content" | "done" |
  "error"`) needs `"thinking"`.

Acceptance Criteria:
- New unit tests (written first, seen failing): (a) model whose /api/show capabilities include
  "thinking" → /api/chat body has `think: true`; (b) model without it → body has no `think` key;
  (c) /api/show failure → no `think`, chat still proceeds; (d) /api/show is called once per model
  across two chats (cache); (e) generation manager: chunks with `message.thinking` produce
  `thinking` events with the right text, ordered before the same chunk's `content`, replayable via
  the events path with correct seqs; eval_count/content counting unaffected.
- All existing server tests still pass, none weakened.

Relevant Files:
- server/src/ollama/client.ts, server/src/ollama/client.test.ts
- server/src/generations/manager.ts, server/src/generations/manager.test.ts
- shared/api.ts (read only: ThinkingEvent already exists)

Files Allowed To Change:
- server/src/ollama/client.ts
- server/src/ollama/client.test.ts
- server/src/generations/manager.ts
- server/src/generations/manager.test.ts

Constraints:
- Follow existing repository patterns. Do not change unrelated behaviour. No new dependencies.
- Do not change shared/, mobile/, ops/, or server/src/http unless strictly needed (it is not expected
  to be: SSE events are forwarded generically).
- Do not restart or touch the running services on the Mac; unit tests only.
- Do not weaken tests. No git stash, no commits (the orchestrator commits).

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/server && bun test && bun run typecheck && bash scripts/entry-smoke.sh

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
