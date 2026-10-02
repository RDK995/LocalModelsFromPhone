# M19g-T4 AC29 Live Run Summary

| ID | Generation ID | Status | Total Wall (s) | Budget (s) | Research Phase Calls | Distinct Pages | Notes Kept | Planning (s) | Routine P50 (s) | Routine P95 (s) | Cited Read Pages | Unresolved Citations | Pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| q1 | null | null | 0.002 | 480 | 0 | 0 | null | 0 | null | null | 0 | [] | false |
| q2 | null | null | 0.002 | 480 | 0 | 0 | null | 0 | null | null | 0 | [] | false |
| q3 | null | null | 0.002 | 480 | 0 | 0 | null | 0 | null | null | 0 | [] | false |
| heat | null | null | 0.002 | 480 | 0 | 0 | null | 0 | null | null | 0 | [] | false |

## Summary

All four AC29 questions (q1, q2, q3, heat) failed with HTTP 409 Conflict errors immediately upon request. The runs received no response data from the server, resulting in zero research phase calls and no pages read.

**Root Cause Analysis:**
Investigation revealed a duplicate server process (PID 82117 from 2026-10-01 13:00) was still running alongside the newly restarted server (PID 3614 from 2026-10-02 21:41). The duplicate process was receiving and rejecting the API requests with HTTP 409 errors, preventing the fresh server instance from processing the requests.

**Actions Taken:**
- Killed the duplicate server process (PID 82117)
- Per task constraints, did not retry failed questions
- Recorded all failures with exit status and results verbatim

**Pass Bar Status (per run):**
- q1: Failed - No done event received; status_ok check failed; cited_read_pages_ok check failed (0 < 3)
- q2: Failed - No done event received; status_ok check failed; cited_read_pages_ok check failed (0 < 3)
- q3: Failed - No done event received; status_ok check failed; cited_read_pages_ok check failed (0 < 3)
- heat: Failed - No done event received; status_ok check failed; cited_read_pages_ok check failed (0 < 3)

