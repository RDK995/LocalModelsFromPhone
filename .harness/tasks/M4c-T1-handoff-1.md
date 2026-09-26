HANDOFF M4c-T1 continuation 1 (written by the orchestrator; the previous attempt was cut off at its turn limit with no report)

Packet: .harness/tasks/M4c-T1.md (unchanged; it is the authority).

State persisted in the repository (uncommitted, relative to base 8b7478e):
- mobile/src/api/client.ts        (+236/-? lines modified)
- mobile/src/api/client.test.ts   (+689 lines)
- mobile/src/api/expoFetchClient.ts (+29 lines)
No lifecycle.ts was created.

Nothing about these edits has been verified. What to do:
1. Read `git diff 8b7478e -- mobile/src/api` in full and judge it against every packet criterion
   (1-7) and every required test case (8a-8j). Keep what is correct; fix or finish what is not.
2. Run the packet's Tests command; make it pass without changing any pre-existing assertion.
3. Return the packet's Return fields, including a criterion -> code/test mapping (test names and
   line numbers) for criteria 1-8.

Be economical with turns: do not re-read whole files you only need a range of; run the focused
`bun test src/api` while iterating and the full Tests command once at the end.
