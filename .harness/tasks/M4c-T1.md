TASK M4c-T1 — Returning the app to the foreground mid-reply resumes the same reply immediately and receives its terminal state; backgrounding never cancels, only Stop does

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: extends the M4b resume loop in one client module with a foreground trigger and an internal per-transport abort; the race (foreground while a read or backoff wait is pending, vs the caller's Stop signal) is the part most likely to be wrong; the fake-fetch/fake-lifecycle unit tests stated below are the oracle.

Goal:
While `APIClient.chat()` (mobile/src/api/client.ts) has a reply in flight, an app-foreground event
makes it abandon the current transport (which iOS may have silently suspended or killed while the
app was in the background) and re-attach at once to the same generation with
`GET /v1/generations/{id}/events` + `Last-Event-ID`, so the caller's `onEvent` still sees every
event exactly once, in order, then the terminal event. Backgrounding itself cancels nothing: it
never POSTs cancel and never aborts the caller's signal. Only Stop (the existing
`stopGeneration` -> `cancelGeneration` POST, and/or the caller's `options.signal`) ends generation.
The app wires the real React Native `AppState` into the client in
mobile/src/api/expoFetchClient.ts; client.ts itself must stay free of any react-native import
(bun-run proof scripts import it).

Relevant Requirements:
FR11 (.harness/requirements.md lines 47-50): "A transport drop or app backgrounding mid-reply does
not cancel the generation on the Mac. On reconnect / return to foreground the app resumes the reply
from where it left off with no gaps and no duplicated text, and receives the terminal state. Only
an explicit Stop cancels." Criterion M4-AC3: "Backgrounding the app mid-reply and returning to
foreground resumes the same reply and receives its terminal state, with only an explicit Stop
cancelling generation." Architecture C2 (.harness/architecture.md lines 58-66): resume-after-drop
"(Last-Event-ID retry with backoff on transport drop, AppState foreground)".

What already exists (from M4b, commit d2f7077 — read it first):
- `chat()` lines ~295-370: `for (;;)` loop over `readSSEStream` (returns "terminal" | "aborted" |
  "drop") and `resumeStream(generationId, options, cursor, firstDropAt)` (backoff via
  `resumeDelayMs(n)` from mobile/src/api/resume.ts, 300 s `RESUME_BUDGET_MS`, returns
  {outcome:"aborted"} | {outcome:"error", error} | {response}). `ResumeCursor` tracks lastId/lastSeq
  and dedupes by seq. A `reader.read()` rejection while `options.signal` is NOT aborted is a drop.
- Constructor `new APIClient(baseUrl, fetchImpl, clock: ClientClock = {})`,
  `ClientClock { sleep?(ms, signal?) ; now?() }` (lines ~64-72, 189-194).
- `createAPIClient` in client.ts (~line 660) and the app's wrapper
  mobile/src/api/expoFetchClient.ts `createAPIClient(baseUrl = SERVER_URL)` used by
  mobile/src/app/chat.tsx and models.tsx.
- Stop: mobile/src/app/chat.tsx `handleStop` (lines ~203-217) calls `stopGeneration` in
  mobile/src/chat/chatController.ts, which POSTs /v1/generations/{id}/cancel and deliberately does
  not abort the fetch; the stream then ends with `done {status:"cancelled"}`.
- Server (do not change): a client abort of any request never cancels the generation; the event log
  is kept 10 minutes.

Acceptance Criteria (each needs a unit test in mobile/src/api/client.test.ts using an injected fake
fetch and an injected fake lifecycle; tests must run instantly via the injected sleep/now):
1. Add an optional injectable lifecycle to the third constructor argument (extend `ClientClock` or
   add a sibling options type; keep `new APIClient(baseUrl, fetchImpl)` and
   `new APIClient(baseUrl, fetchImpl, { sleep, now })` compiling and behaving exactly as today):
   `lifecycle?: { isForeground(): boolean; onForeground(listener: () => void): () => void }`
   (returns an unsubscribe). Default when absent: always foreground, never fires — i.e. M4b
   behaviour unchanged.
2. Every transport request `chat()` makes (the POST /v1/chat and each resume GET) uses an internal
   AbortController that is aborted when `options.signal` aborts (and is linked the same way as
   today's signal so user Stop semantics are unchanged). Aborting the internal controller for a
   foreground reason makes the pending read end as a "drop", never as "aborted".
3. `chat()` subscribes to `lifecycle.onForeground` once when the reply starts and unsubscribes when
   it settles (onComplete or onError, every path, including thrown errors). A foreground event while
   the reply is in flight:
   a. during a pending `reader.read()`: aborts that transport's internal controller; the loop
      treats it as a drop and resumes with no backoff wait before this first foreground-triggered
      attempt (delay 0), using `Last-Event-ID` of the last event seen;
   b. during a backoff wait: ends the wait early and makes the next attempt immediately;
   c. during a resume fetch that has not yet returned: no additional request is started (at most
      one transport in flight at any time);
   d. after the reply has settled: does nothing (no request).
   After a foreground event the attempt counter resets to 1 and the budget clock (`firstDropAt`)
   restarts from `now()`.
4. Budget while backgrounded: if the 300 s budget would be exhausted while
   `lifecycle.isForeground()` is false, do NOT call onError; instead wait (without requests) until
   the next foreground event (or the caller's signal aborts -> onComplete once, as today), then
   resume per 3b. Budget exhaustion while in the foreground behaves exactly as in M4b.
5. Backgrounding cancels nothing: nothing in the client reacts to a background transition; no code
   path other than `cancelGeneration` POSTs /cancel, and `chat()` never calls it.
6. No duplicates / no gaps: all M4b dedupe-by-seq rules still apply across foreground resumes.
7. Wire the real AppState in mobile/src/api/expoFetchClient.ts: pass a lifecycle whose
   `isForeground()` is `AppState.currentState === "active"` and whose `onForeground(l)` registers
   `AppState.addEventListener("change", s => { if (s === "active" && previous !== "active") l(); })`
   (track the previous state per subscription) and returns `() => sub.remove()`.
8. Tests covering at least: (a) foreground during a pending read after events g-1,g-2 -> the chat
   transport is aborted, exactly one GET events with Last-Event-ID `g-2`, sleep not called with a
   non-zero delay before it, events g-3..done delivered once each, onComplete once, onError never;
   (b) the resumed stream re-sends g-2 -> delivered once; (c) the generation already finished while
   backgrounded (resume body = remaining events + done) -> terminal done delivered once;
   (d) foreground during a backoff wait -> wait ends, next GET happens immediately;
   (e) budget elapsed while background (isForeground false) -> no onError; after foreground a GET
   is made and the reply completes; (f) foreground after settle -> no request, listener unsubscribed
   (assert the unsubscribe function was called on complete AND on error paths);
   (g) no request to any `/cancel` URL in any of the above, and the caller's signal is never
   aborted by the client; (h) user Stop (caller signal aborted) after a foreground resume ->
   no further requests, onComplete once; (i) two foreground events in quick succession while a
   resume GET is pending -> still only one transport in flight; (j) a client constructed without a
   lifecycle behaves exactly as before (existing M4b tests unchanged and passing).

Relevant Files:
- mobile/src/api/client.ts (chat, readSSEStream, resumeStream, ClientClock, constructor)
- mobile/src/api/client.test.ts (existing fake-fetch patterns and M4b cases (a)-(k))
- mobile/src/api/resume.ts (resumeDelayMs, RESUME_BUDGET_MS)
- mobile/src/api/expoFetchClient.ts
- mobile/src/chat/chatController.ts, mobile/src/chat/conversationSession.ts, mobile/src/app/chat.tsx
  (read only: callers and Stop wiring)

Files Allowed To Change:
- mobile/src/api/client.ts
- mobile/src/api/client.test.ts
- mobile/src/api/resume.ts
- mobile/src/api/resume.test.ts
- mobile/src/api/expoFetchClient.ts
- mobile/src/api/lifecycle.ts (new, optional: the lifecycle type and/or AppState adapter; if the
  AppState adapter lives here it must not be imported by client.ts)
- mobile/src/api/lifecycle.test.ts (new, optional)

Constraints:
- Follow existing repository patterns.
- Do not change unrelated behaviour. Do not change the server, the chat screen, the session or
  controller modules, or the StreamOptions callback shape.
- client.ts must not import react-native (bun-run scripts import it).
- Do not introduce dependencies.
- Do not weaken tests: no existing assertion may change.
- Do not use git stash, and do not commit (the orchestrator commits).

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun run typecheck && bun test src/api src/chat src/store src/ui src/app-routing && bun run lint && bun run smoke:runtime

Return:
- Summary
- Files changed
- Tests run
- Test result
- Unresolved issues
