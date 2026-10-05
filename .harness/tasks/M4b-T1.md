TASK M4b-T1 — The app's chat client transparently resumes a reply across a dropped connection (Last-Event-ID replay with backoff), with no gaps, no duplicates, and the terminal event delivered

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: stream-reading and retry logic in one client module; the error classification (user Stop vs transport drop vs callback exception) is the part most likely to be wrong, and fake-fetch unit tests stated below are the oracle.

Goal:
`APIClient.chat()` in mobile/src/api/client.ts keeps delivering the same reply after a transport
drop, by re-attaching to the generation with `GET /v1/generations/{id}/events` and a
`Last-Event-ID` header, retrying with backoff, so that the caller's `onEvent` sees every event of
the generation exactly once, in order, followed by the terminal event, and `onComplete`/`onError`
is called exactly once. Callers (mobile/src/chat/conversationSession.ts, mobile/src/chat/* and
mobile/src/app/chat.tsx) must not need to change.

Relevant Requirements:
FR11 (dropped-connection recovery: a transport drop mid-reply does not cancel the generation; on
reconnect the app resumes the same reply and receives its terminal state) — .harness/requirements.md
lines 47-50. Architecture C2 (.harness/architecture.md lines 58-66): "resume-after-drop
(Last-Event-ID retry with backoff on transport drop)"; I1: "an async iterator of reply events that
transparently resumes across drops" (the existing callback shape is kept; do not change the
public signature).

Server facts (already built, do not change the server):
- Every SSE event from POST /v1/chat and GET /v1/generations/{id}/events carries
  `id: <generationId>-<seq>`; seq is a non-negative integer increasing by 1 per event.
- GET /v1/generations/{id}/events with `Last-Event-ID: <gen>-<n>` replays from seq n+1, then
  continues live; with no header it replays from seq 0. It starts with an SSE comment line
  `: connected` (ignore it). 404 `{error:"unknown_generation"}` when the log is gone.
- Aborting the /v1/chat request does NOT cancel the generation on the server.
- `done` and `error` events are terminal; the server closes the stream after them.

Acceptance Criteria (each needs a unit test in mobile/src/api/client.test.ts using an injected fake fetch):
1. Track the SSE `id:` field of each event. Remember the last id seen and its seq (parsed with
   /-(\d+)$/).
2. A drop is: `reader.read()` rejecting with any error while `options.signal` is not aborted
   (this includes an AbortError whose origin is not the caller's signal), OR the body ending
   (`done: true`) before a `done`/`error` event was delivered. Today the latter calls onComplete;
   that is the behaviour being replaced.
3. On a drop, retry: before attempt n (1-based) wait `resumeDelayMs(n)` = 500, 1000, 2000, 4000,
   8000 ms for n=1..5, then 10000 ms for every later attempt (port from
   /Users/ryankenny/Projects/phoneToLocalModel/web/src/recovery-policy.ts `recoveryDelayMs`),
   then `GET {baseUrl}/v1/generations/{generationId}/events` with the same auth headers,
   `Last-Event-ID: <last id seen>` (omit the header entirely if no id was seen yet), and
   `signal: options.signal`. Parse its body exactly as the chat body is parsed; a drop on the
   resumed stream triggers the same retry loop again. The attempt counter resets to 1 whenever a
   resume request returns 200.
4. No duplicates: an event whose seq is <= the last delivered seq is not delivered to onEvent.
5. A resume request that throws (network error) or returns 502/503/504 counts as a failed attempt
   and the loop continues. 404 ends the loop with `onError(new ServerError("unknown_generation",
   <message from body or a default>))`. 401 ends it with `onError(new UnauthorizedError())`. Any
   other non-200 ends it with onError of a ServerError carrying the body's error code.
6. Budget: if more than `RESUME_BUDGET_MS` = 300000 ms have elapsed since the first drop of this
   reply when the next attempt would start, stop and call `onError` with an Error whose message
   says the connection to the Mac was lost and could not be restored. Budget and delays use an
   injectable clock/sleep (see Constraints) so tests run instantly.
7. User Stop is unchanged: if `options.signal` is aborted (during a read, a resume fetch or a
   backoff wait), stop without further requests and call `onComplete` exactly once (existing
   "normal cancellation" semantics). A pending backoff wait must end promptly when the signal
   aborts.
8. An exception thrown by the caller's own `onEvent` callback is NOT a drop: it goes to `onError`
   exactly as today and no resume happens (conversationSession.ts relies on this: it throws on an
   `error` event to route it to onError).
9. After a `done` event is delivered, stop reading (cancel the reader) and call `onComplete` once.
   `onStart` is still called exactly once, with the x-generation-id of the original /v1/chat.
10. Tests covering at least: (a) chat body errors after events g-1,g-2 → one GET events request
    with Last-Event-ID `g-2` → events g-3.. and done delivered; onEvent sees g-1..done once each;
    onComplete once; (b) resume stream re-sends g-2 → not delivered twice; (c) body ends without a
    terminal event → resume happens; (d) drop before any event with an id → resume request has no
    Last-Event-ID header; (e) user abort mid-read → no resume request, onComplete once;
    (f) user abort during a backoff wait → no resume request, onComplete once; (g) failed attempts
    wait 500, 1000, 2000... (assert the injected sleep's arguments); (h) 404 → onError
    unknown_generation, no further requests; (i) budget exhausted → onError, loop stops;
    (j) onEvent throwing → onError, no resume request; (k) a drop on the resumed stream resumes
    again from the latest id.

Relevant Files:
- mobile/src/api/client.ts (chat(), parseSSEEvent, constructor, createAPIClient)
- mobile/src/api/client.test.ts (existing fake-fetch patterns)
- mobile/src/chat/conversationSession.ts, mobile/src/chat/ (callers of client.chat — read only)
- /Users/ryankenny/Projects/phoneToLocalModel/web/src/recovery-policy.ts and sse-reader.ts (reuse source, read only)
- server/src/http/server.ts lines 300-375 (SSE id format and resume semantics — read only)

Files Allowed To Change:
- mobile/src/api/client.ts
- mobile/src/api/client.test.ts
- mobile/src/api/resume.ts (new: resumeDelayMs, RESUME_BUDGET_MS)
- mobile/src/api/resume.test.ts (new, optional)

Constraints:
- Follow existing repository patterns.
- Do not change unrelated behaviour.
- Do not introduce dependencies unless required (none are).
- Do not weaken tests. The only existing tests you may change are ones that assert a body ending
  WITHOUT a terminal event calls onComplete; that is the behaviour AC2 replaces. Name every existing
  test you change, and why, under Unresolved Issues. No other existing assertion may change.
- Keep the constructor call `new APIClient(baseUrl, fetchImpl)` and `createAPIClient(...)` working
  unchanged; add injection as an optional third constructor argument, e.g.
  `{ sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number }`, defaulting
  to real timers / Date.now.
- Do not change the server, the chat screen, the session module, or the StreamOptions callback shape.
- Do not use git stash, and do not commit (the orchestrator commits).

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test src/api src/chat src/store src/ui src/app-routing && bun run lint && bun run smoke:runtime

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
