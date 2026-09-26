TASK M5b-T3 — Bodiless gateway error (server down behind the Tailscale proxy) surfaces as UnreachableError

Routing: tier Mid, model sonnet, reason_code ORDINARY_IMPLEMENTATION
  detail: correction to the M5b-T1 client error handling found by the M5b-T2 live proof; touches
  several request paths in client.ts whose microtask timing other tests depend on.
Depends on: M5b-T1 (accepted, e6a3aa5). Found by M5b-T2 (live proof, scenario 6 failed).

Problem (demonstrated live, evidence .harness/evidence/M5b-T2-worker.log):
When the Mac's server is stopped (`launchctl bootout gui/$(id -u)/com.harness.server`), the request
over the tailnet URL does NOT fail at the network level. Tailscale's TLS-terminating proxy in front
of port 8443 answers `HTTP 502` with `content-length: 0` and no body. In Bun (and potentially other
runtimes) `response.json()` on such a response can resolve to `null` instead of rejecting. Then:
- `getState()` calls `parseErrorBody(response)` and reads `body.error` → TypeError
  ("null is not an object (evaluating 'body.error')").
- `assertLoadUnloadOk` (load/unload) does `body = await response.json()` then `body.error` → same.
- Even with null guarded, these paths would throw a generic `Error("Failed to …")`, which
  `describeError` does not map to UNREACHABLE_MESSAGE.
So the "Mac or server unreachable" message (M5-AC3) never reaches the user when the Mac is up but
the server is down.

Relevant Requirements:
- FR16 / M5-AC3 (.harness/requirements.md line 65): a distinct message for "Mac or server unreachable".

Acceptance Criteria:
1. `parseErrorBody` (and any other place in client.ts that parses a non-OK response body, including
   `assertLoadUnloadOk`) treats a body that is null, non-object, empty or unparseable as `{}` — it
   never throws a TypeError.
2. For a non-OK, non-401 response whose body carries NO `error` code, and whose status is 502, 503
   or 504, `getState()`, `loadModel`/`unloadModel` (via assertLoadUnloadOk), and the initial chat
   POST throw `UnreachableError` (the gateway reports the server behind it is unreachable).
3. A non-OK response that DOES carry a JSON `{error, message}` body keeps its current behaviour
   exactly (ServerError / ConfirmationRequiredError / ModelNotResidentError etc.) regardless of
   status — in particular the server's own Ollama-down response must still map to
   OLLAMA_DOWN_MESSAGE, not unreachable. Non-gateway statuses without a body keep today's generic
   Error.
4. The resume/reconnect loop's existing 502/503/504 retry behaviour (around line 833) is unchanged.
5. New unit tests in src/api/client.test.ts (Red first): for getState, loadModel and chat start, a
   fake fetch returning `new Response(null, {status: 502})` → UnreachableError, and
   `describeError(err)` === UNREACHABLE_MESSAGE; and a response whose `.json()` resolves to `null`
   (e.g. a Response subclass / object overriding json) → no TypeError, UnreachableError for 502.
   Plus one test that a 503 with `{error:"<the server's ollama-down code>"}` body still gives
   ServerError mapping to OLLAMA_DOWN_MESSAGE (find the code in errorMessages.ts).

Relevant Files:
- mobile/src/api/client.ts (parseErrorBody ~line 850, assertLoadUnloadOk ~line 315, getState ~343,
  chat start ~405, resume loop ~813-845)
- mobile/src/api/client.test.ts, mobile/src/api/errorMessages.ts (read only), errorMessages.test.ts
- Note the comment above rethrowFetchFailure: do not add extra async hops around the initial fetch;
  the resume/foreground tests depend on microtask timing.

Files Allowed To Change:
- mobile/src/api/client.ts
- mobile/src/api/client.test.ts

Constraints:
- Do not change server/, shared/, errorMessages.ts, or mobile/scripts/ (the untracked
  error-messages-proof.* files belong to M5b-T2; leave them untouched).
- Do not weaken or delete existing tests.
- Do not run the live proof script; this task is unit-level only. Never git stash, commit, or push.

Tests:
cd /Users/ryankenny/Projects/CodingHarnessv2/mobile && bun test && bun run typecheck && bun run lint
Save full output to .harness/evidence/M5b-T3-worker.log.

Return:
- Summary, Files changed, Tests run, Test result (with exit status), Unresolved issues
