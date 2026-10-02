M18-T3 continuation handoff 1 (written by the orchestrator, 2026-10-02)

State on disk (uncommitted, on top of 709b16a): attempt 3 implemented every packet item in
deepResearch.ts, streamReducer.ts, chatItems.ts, conversationStore.ts, conversationSession.ts,
chat.tsx and their tests. bun test: 485 pass, 1 fail — conversationSession.test.ts case
"persists content, steps, sources with n and research status; a fresh store returns the same",
failing because mobile/src/api/client.ts `parseSSEEvent` drops plan/write steps, step
elapsed_ms/budget_ms and done.research. That file was outside the packet's allowed list; the packet
is now amended to allow mobile/src/api/client.ts and client.test.ts for exactly that parsing fix.

Remaining work: Red-first tests in client.test.ts for the three parsing gaps, fix parseSSEEvent,
then make the full Tests command pass. Review the existing uncommitted work against the packet
rather than trusting this summary; do not redo it.
