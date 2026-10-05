M19-T2 handoff 1 (written by the orchestrator; the previous worker hit its turn limit and returned no report)

State on disk: server/src/http/deepResearchResume.test.ts (new, 355 lines, uncommitted) from the
interrupted attempt. Treat it as unverified. Orchestrator ran
`cd server && bun test src/http/deepResearchResume.test.ts`: 2 pass, 1 fail. The failing test is
"unload mid-run: without confirm is refused, with confirm ends the run and cleans up" with
`TypeError: The socket connection was closed unexpectedly` from fetch, failing in under 1 ms — this
looks like the test's own server/fake wiring (e.g. a server not started, closed early, or a fetch to
the wrong port), not product behaviour. Read how existing tests drive /v1/models/unload (grep
"/v1/models/unload" in server/src/http/*.test.ts and server/src/models/*.test.ts) and copy that
wiring exactly.

Also re-check the two passing tests against the packet's criteria 1 and 2 (exact assertions stated
there) and tighten them if they do not assert what the packet states.

You have a limited turn budget: iterate only on that one file, then run the packet's Tests command
once. If you near your limit, stop and return CONTINUE with a precise list of done and remaining.
