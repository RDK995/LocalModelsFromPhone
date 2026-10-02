# M19g-T5 diagnosis: live q1 report with zero [n] citations

## Cause

The write prompt only *restricts* citation form ("Cite pages only as [n] using the note numbers"); it
never *requires* a citation on the claims. With thinking on (M16-T5, no guard yet) the model planned
its citations while thinking and cited 4 pages. In q1 the FR42 write guard fired (thinking still running
at 60 s), and the re-issued `think: false` write followed the same prompt literally: it wrote fluent
prose from the notes and cited nothing. FR37's filter (`cleanReport`) did not strip anything and the
notes/sources numbering is consistent; there was simply no `[n]` in the model's reply.

## Evidence

- `.harness/evidence/M19g-T4-q1-fr41.log`, last three lines:
  - `write` think:true attempt 1 `outcome:"guard"` wall_ms 60002, thinking_chars 11694 (no answer
    content by the guard).
  - `write` think:false attempt 2 `outcome:"ok"`, prompt_eval_count 760, eval_count 438.
  - `deep_research_run_end` notes_kept 13, pages_read 5.
- `.harness/evidence/M19g-T4-q1-stream.txt`: the one `content` event has no `[`...`]` of any kind (so
  no stripped-citation residue such as `[Note 3]`, `[^1]` or out-of-range numbers left in the text);
  the `sources` event has n 1..5, matching pages_read 5, so read numbers 1..5 are all in `readNumbers`
  and any `[1]`..`[5]` would have survived `cleanReport`.
- Prompt size is not the cause. Ollama's `prompt_eval_count` is the full prompt token count (cached
  prefix included; prompt_eval_duration 92 ms shows the prefix was reused from the cancelled attempt).
  The queries prompts grew 276 -> 438 -> 564 tokens as notes accumulated; 760 for brief + plan + 13
  notes + task is consistent with every note being present (notesCapChars 8000 chars was not reached).
  The diagnostic below with 13 short synthetic notes is 588 tokens.
- Contrast: `.harness/evidence/M16-T5-stream.txt` cited [1]..[4]. At that commit (5c348fd) the write
  call used the identical task text but `think: true` with no guard, so it always got its thinking.

## Diagnostic Ollama requests (3 of 3 allowed)

`pgrep -fl ac29-live-run` empty before each; `/api/ps` showed qwen3.5:35b-a3b resident (keep_alive -1
sent, no load/unload). Script: `.harness/evidence/M19g-T5-diag.ts` (builds the request with research.ts
`SYSTEM_INSTRUCTIONS`, `SCHEMAS.write`, the `context()` layout, `num_ctx` 32768, `think:false`, i.e. the
FR42 re-issue shape, with 13 synthetic Raft/Paxos notes numbered [1]..[4]). Full outputs:

1. `M19g-T5-diag-req1.json` - production task text, think:false: 7.2 s, 315 tokens, report with
   **zero** `[n]` citations. Reproduces q1.
2. `M19g-T5-diag-req2.json` - task requiring every fact sentence to end with its note's [n], with an
   example: every sentence cited, [1]..[4] all used.
3. `M19g-T5-diag-req3.json` - the generic wording shipped in the fix ("Cite as you write: every
   sentence that uses a note must end with that note's page number in square brackets, for example
   "... as the page states [n]." Use only the [n] numbers shown in the notes; never cite anything
   else."), example number taken from a real note: every sentence cited, [1]..[4] all used.

## Fix

Prompt-only, inside FR35/FR37/FR42: the write task text (sent identically on the thinking attempt and
the think:false re-issue) now requires a `[n]` on every sentence that uses a note, with an example whose
number is a real note's page number. No new retry, no policy change, FR37 filter unchanged.
Not done (would be requirement-level, for the human): validating "report has >= 1 citation" and
retrying/re-issuing, or a structured write schema with per-paragraph source numbers.
