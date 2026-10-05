# M19j-T6 diagnosis: why live run r1 (heat) read 2 pages and cited 1

Diagnosis only; no source, test, script or config changed. Nothing was contacted (no server, Ollama or search
backend). Commit at diagnosis time: `bc73e809a84786bb714d614b5ba49e16706f8a55` (branch m19j-live-priced-reports).

Evidence used:
- `.harness/evidence/M19j-T4-r1-heat-stream.txt` (SSE stream of r1)
- `.harness/evidence/M19j-T4-r1-heat-fr41.log`, `M19j-T4-r1-heat-result.json`
- `.harness/evidence/M19j-T4-r2-heat-fr41.log`, `M19j-T4-r3-heat-fr41.log`, `M19j-T4-r4-ev-fr41.log`,
  `M19g-T7-heat-fr41.log`, `M19j-T4-r2-heat-stream.txt` (comparison)
- `~/Library/Logs/phone-models/server.log` (lines 228-239 are the restart and the r1 window), and
  `~/Library/Logs/phone-models/search.log` (last modified `2 Oct 22:47`, i.e. before r1; it holds nothing for r1)
- `server/src/generations/research.ts` at the commit above

## Verdict

**Category (c) model behaviour, let through by a deliberate code tolerance.** The plan step's reply contained
exactly one sub-question instead of the three it was asked for. The server accepts a shorter plan, and with one
sub-question the code caps reading at 2 pages (`pagesPerSubQuestion: 2`). So r1 could not reach 3 read pages
whatever the search backends did. The search and page layer worked normally: both searches and both reads
finished `done`, and nothing in the logs shows an error, rate limit, block or timeout.

The second failure (only 1 page cited) came after that. The write step hit its thinking guard and was re-issued with
thinking off. The re-issue produced a 68-token, two-sentence report that cited only `[2]`.

## 1. r1 step sequence (quoted from `M19j-T4-r1-heat-stream.txt` and `M19j-T4-r1-heat-fr41.log`)

| # | Step | Quoted evidence |
|---|------|-----------------|
| 1 | brief | fr41: `"step":"brief","think":false,"attempt":1,"wall_ms":1710,...,"eval_count":45,...,"outcome":"ok"` |
| 2 | plan, thinking (guard fired) | fr41: `"step":"plan","think":true,"attempt":1,"wall_ms":30003,...,"thinking_chars":6294,...,"outcome":"guard"` |
| 3 | plan, re-issued thinking off | fr41: `"step":"plan","think":false,"attempt":2,"wall_ms":1177,...,"prompt_eval_count":253,...,"eval_count":47,...,"outcome":"ok"` |
| | plan phase ends | stream: `{"step_id":"plan","kind":"plan","status":"done","elapsed_ms":32899,...}` |
| 4 | one query proposal | stream: `"kind":"model","status":"started","detail":"Choosing searches","elapsed_ms":32901` / fr41: `"step":"queries",...,"eval_count":104,...,"outcome":"ok"` |
| 5 | search 1 | stream: `"kind":"search","status":"done","query":"UK electricity and gas unit price October 2026 pence per kWh","elapsed_ms":40507` |
| 6 | search 2 | stream: `"kind":"search","status":"done","query":"current UK energy price cap Oct 2026 gas electricity cost","elapsed_ms":43311` |
| 7 | one page choice | stream: `"detail":"Choosing pages","elapsed_ms":51303` / fr41: `"step":"pages",...,"prompt_eval_count":5626,...,"eval_count":15,...,"outcome":"ok"` |
| 8 | read 1 | stream: `"kind":"read","status":"done","url":"https://www.cse.org.uk/current-gas-and-electricity-prices/","elapsed_ms":51976` |
| 9 | notes 1 | stream: `"detail":"Taking notes: cse.org.uk","elapsed_ms":56148` (done) |
| 10 | read 2 | stream: `"kind":"read","status":"done","url":"https://www.theenergyshop.com/guides/compare-gas-electricity-prices-per-kwh","elapsed_ms":56149` |
| 11 | notes 2 | stream: `"detail":"Taking notes: theenergyshop.com","elapsed_ms":62793` (done) |
| 12 | write, thinking (guard fired) | fr41: `"step":"write","think":true,"attempt":1,"wall_ms":60001,...,"thinking_chars":11789,...,"outcome":"guard"` |
| 13 | write, re-issued thinking off | fr41: `"step":"write","think":false,"attempt":2,"wall_ms":1598,...,"eval_count":68,...,"outcome":"ok"` |
| | end | fr41: `{"event":"deep_research_run_end","notes_kept":2,"pages_read":2,"status":"complete","elapsed_ms":124396}` |

The whole report (stream event 20):
`"For October 2026, the projected unit price for natural gas in the UK is 7.97 pence per kWh [2]. The projected unit
price for electricity in the UK for the same period is 26.32 pence per kWh [2]."`
The sources list (event 21) has 2 entries (`"n":1` theenergyshop.com, `"n":2` cse.org.uk). Only `[2]` is cited, which
matches `"cited_read_pages": 1` in the result JSON.

Stream status tally: `10 "status":"started"`, `10 "status":"done"`, `2 "status":"complete"`. There are **no**
`failed` or `unavailable` step events.

What the evidence does **not** record (see section 6): the plan's sub-question text, and how many results each search
returned. Neither the stream nor any log carries them.

## 2. The cause: the plan had exactly one sub-question

**How we know it was one.** In round 1, the code runs every plan sub-question through `searchOnce`, then
`nextQuery`. Each sub-question starts with an empty query queue, so each one makes its own `"Choosing searches"`
model call (`research.ts` 800-810: `if (sq.proposals < s.maxSearches) { sq.proposals++; ... modelCall("Choosing
searches", "queries", ...`). r1 has exactly **one** `queries` call in fr41 and exactly one `"Choosing searches"` step in
the stream. A plan with 2 or more sub-questions would show 2 or more such calls before the write step. The plan call's
`"outcome":"ok"` means `VALIDATORS.plan` accepted a non-empty list (`research.ts` 323-326:
`return list && list.length ? list : null;`). It did not fall back to `[brief]`. So the list had length 1.

**Corroboration: output size.** The thinking-off plan reply was `"eval_count":47`. Across every run in
`server.log`, the thinking-off plan replies were 88-140 tokens and every one of those runs read 5-6 pages. r1 is the
only outlier (awk tally over `server.log`):

```
138 plan_eval=96  "pages_read":5
157 plan_eval=88  "pages_read":6
174 plan_eval=124 "pages_read":5
192 plan_eval=123 "pages_read":6
210 plan_eval=129 "pages_read":6
227 plan_eval=101 "pages_read":5
239 plan_eval=47  "pages_read":2    <- r1
257 plan_eval=135 "pages_read":6    <- r2
275 plan_eval=140 "pages_read":6    <- r3
293 plan_eval=116 "pages_read":6    <- r4 (ev)
```

**The prompt was the same; the reply differed.** r1's plan prompt was `"prompt_eval_count":253`. r2's was
`"prompt_eval_count":255` and r3's was `254`, for the same question. The re-issue sends no sampling options
(`research.ts` 546: `const reissue: OllamaChatRequest = { ...request, think: false, options: { num_ctx: s.numCtx } };`).
So it samples with the model's defaults, and the difference is the model's sampled output.

**What the single sub-question was about (inferred, not logged).** The only queries run were
`"UK electricity and gas unit price October 2026 pence per kWh"` and
`"current UK energy price cap Oct 2026 gas electricity cost"`. That is the unit-price sub-question that M19i's
`PLAN_PRICES_RULE` asks for (`research.ts` 191-192: `"... one of the sub-questions must ask for the current unit prices
relevant to the question (for example electricity and gas prices per kWh in the user's country)."`). In r2, the price
queries were one of three topics. The r2 stream also has `"UK heat pump installation cost October 2026 average"` and
`"heat pump performance in cold weather UK autumn winter"`. A plausible reading is that the model collapsed the plan
onto the price rule's example. The plan text was not logged, so this cannot be confirmed.

**Why one sub-question means at most 2 pages: the code path.**
- `research.ts` 55: `/** Sub-questions the plan is cut to (extra dropped, fewer tolerated). */`
- `research.ts` 974: `plan = p ? p.slice(0, Math.max(1, s.subQuestionCount)) : [brief];` (a 1-item plan is kept as is)
- `research.ts` 96-99: `subQuestionCount: 3,` `minSearches: 2,` ... `pagesPerSubQuestion: 2,`
- `research.ts` 996: `const firstRoundSearches = Math.min(Math.max(1, s.minSearches), s.maxSearches);` (= 2, which matches the 2
  searches seen)
- `research.ts` 859: `const remaining = s.pagesPerSubQuestion - sq.reads;` (= 2, so the page choice picked 2 pages, which
  matches `"eval_count":15` and the 2 reads)
- `research.ts` 1023: `if (sq.searchOver || sq.reads >= s.pagesPerSubQuestion) { sq.done = true;` After the 2 reads, the
  only sub-question is done. No gap check runs (fr41 has no `"step":"gap"` line), and the loop ends.

The run-wide page ceiling is `plan.length × pagesPerSubQuestion`. That is 3 × 2 = 6 for r2-r4 (each read exactly 6)
and 1 × 2 = 2 for r1. **Why the research phase stopped after 4 calls:** queries, pages, notes and notes were all the work
a one-sub-question plan allows. It was not a deadline (`elapsed_ms` 62793 of `budget_ms` 480000 when writing
started) and it was not a failure.

## 3. Not an external search/page failure (category a ruled out)

- Both searches ended `"status":"done"` and both reads ended `"status":"done"`. The stream has no `failed` or
  `unavailable` status. `searchOnce` returns `"failed"` only for those statuses (`research.ts` 840-843).
- The searches returned plenty of candidates. The page-choice prompt was `"prompt_eval_count":5626`, larger than
  any page-choice prompt in r2 (`1315`, `3734`, `1526`), r3 (`4873`, `4801`, `4766`) or M19g-T7 heat (`3337`, `4141`,
  `2712`). Exact per-search result counts are not logged (section 6).
- In `server.log`, every line that is not a deep-research event reads only
  `phone-models server listening on http://127.0.0.1:7789` (124 occurrences). There are no error, rate-limit,
  block, CAPTCHA or timeout lines anywhere, including lines 228-239 (the r1 window, which starts right after the T3
  restart at lines 228-229). `search.log` was last written `2 Oct 22:47`, before r1.

## 4. Code defect? (category b): not a defect against the code's stated design; possible requirement gap

The code does what its comments say: `"extra dropped, fewer tolerated"` (line 55). FR35
(`.harness/requirements.md` 270-271) says: `"(2) plan — split it into sub-questions (the count is set by the server,
not the model)"`. Line 974 enforces the server's count only as a maximum. When the model returns fewer, the model has
in effect set the count. Whether FR35 requires a minimum to be enforced (for example, retrying a plan that has too few
sub-questions, or topping it up) is a product/requirements decision. I have not decided it here. If it is decided that
FR35 requires the full count, the place to change is `research.ts` 974 (and/or `VALIDATORS.plan`, 323-326, which
accepts any non-empty list).

## 5. Second contributor: the write re-issue cited 1 of 2 pages

With 2 pages read, the bar of 3 could not be met anyway. Even so, the report cited only one of them. The write step
behaved as in every run: the thinking attempt hit the 60 s guard (`"outcome":"guard"` appears for write in r1, r2, r3, r4
and M19g-T7). But r1's thinking-off re-issue was very short: `"eval_count":68` and `"prompt_eval_count":546`. The
passing runs had 339-708 tokens (r2 `570`, r3 `708`, r4 `339`, M19g-T7 `505`). The small prompt reflects
`"notes_kept":2`, so the writer had 2 notes to work from. Both quoted figures cite `[2]`. Page [1] (theenergyshop.com)
went uncited. This is also model behaviour on thin input, and it follows from the one-sub-question plan.

## 6. What the evidence cannot establish

- **The plan's sub-question text.** Neither FR41 logging (`ModelCallLog` fields only) nor the stream records plan
  content. That the plan had exactly one sub-question is established structurally (section 2). That it was the
  unit-price sub-question is inferred from the queries.
- **Results per search.** The web tools write no log line per search (server.log holds no search lines, and search.log
  predates r1). The stream's search step events carry no result count. Only the 5626-token page-choice prompt shows
  the result list was large.
- **Whether `PLAN_PRICES_RULE` caused the collapse.** One bad plan in 4 runs on the M19i code (r1-r4, server.log
  239-293), against 0 in 6 earlier runs (138-227, before the restart at 228). That is too few runs to tell a
  price-rule effect from sampling noise.

## 7. Could it recur on a rerun?

Yes. The thinking plan attempt hit its guard in every run observed (`"outcome":"guard"` on plan in r1, r2, r3, r4 and
M19g-T7). So the plan always comes from a single thinking-off re-issue with default sampling and no check on the count
(research.ts 546, 974). From the evidence, a short plan happened in **1 of 10** runs in `server.log` overall, and in
**1 of 4** runs since the M19i prompt change. Roughly 10-25% per run is a fair rough range on this small sample. Any
run that gets a one-sub-question plan fails M19j-AC1's 3-page bar by construction (ceiling 2 pages). A two-sub-question
plan (ceiling 4) could pass, but with little margin.

## 8. Inside M20's scope?

**No.** M20 is `"Search backends rest after being blocked, and repeated searches and page reads come from cache"`
(`.harness/milestones.md` 566). Its criteria are backend breakers for rate-limit/CAPTCHA (M20-AC1, line 586), a 24-hour
search/page cache (M20-AC2, line 587), and ordinary replies sharing them (M20-AC3, line 588). r1 had no blocked or
failed backend and no failed read (section 3). Its cause sits in the plan step's output and in how the code accepts a
shorter plan (research.ts 974). A cache could even make it worse: it would replay the same narrow searches faster. It
would not add sub-questions.
