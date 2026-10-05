# M19j-T5 — judgement of the four live reports against M19j-AC2 and M19j-AC3

Commit at judgement: 4884fd1 (streams unchanged since M19j-T4) (branch m19j-live-priced-reports). Today: 2026-10-03.

## How the reports were extracted and checked

- Each `.harness/evidence/M19j-T4-<RUN>-stream.txt` was parsed with a verbatim JS copy of `parseSse`
  (server/scripts/ac29-live-run.ts) in a one-off scratch script (not in the repository). Report text = the
  concatenation of every `content` event's `data.text` (each run has exactly one `content` event); sources = the
  `sources` event's `items` (n, title, url).
- Written to `.harness/evidence/M19j-T5-<RUN>-report.md` between `<!-- REPORT-START -->\n` and
  `\n<!-- REPORT-END -->`. Check: the text between those markers was read back and compared byte-for-byte
  (`Buffer.equals`) with the concatenated content text from the stream:
  - r1-heat: 1 content event, 194 chars, byte-equal true
  - r2-heat: 1 content event, 2323 chars, byte-equal true
  - r3-heat: 1 content event, 2919 chars, byte-equal true
  - r4-ev: 1 content event, 1310 chars, byte-equal true

## What source / note text was visible

The stream carries only: `step` events (plan/model/search/read/write, with `query` for searches, `url` for reads,
and `detail` such as "Taking notes: cse.org.uk"), one `content` event, one `sources` event (n, title, url) and one
`done` event (status, model, eval_count, tokens_per_second, research status/elapsed). The fr41.log files carry only
per-call timing/count fields (and `notes_kept`/`pages_read` at run end). **No note text, passage text or page text is
present in any saved artefact.** So for every judgement below, "does the cited note give it" can only be checked
against the cited source's title and URL (and, where useful, the search query that found it and cross-run
consistency). Nothing was fetched (no server/Ollama/web contact). Every "note not visible" statement below means this.

All citations [n] in all four reports resolve to an entry in that report's sources list (result.json
`unresolved_citations: []` for all four; confirmed by reading). Every cited source was also a page actually read in
that run (its URL appears in a `read` `done` step event).

---

## r1-heat (AC29 pass bar failed: 1 cited read page — judged anyway)

Sources: [1] Gas & Electricity Prices per kWh in the UK — theenergyshop.com; [2] current gas and electricity
prices — cse.org.uk/current-gas-and-electricity-prices/.

### AC2
- GBP (£) running-cost figures: **none.** The whole report is two sentences giving unit prices in pence:
  "the projected unit price for natural gas in the UK is 7.97 pence per kWh [2]" and "The projected unit price for
  electricity in the UK for the same period is 26.32 pence per kWh [2]." No usage, no sum, no £ figure.
- Verdict: **NO.**

### AC3
- "For October 2026, the projected unit price for natural gas in the UK is 7.97 pence per kWh [2]" — names
  October 2026 (the current month, not a past period). Cited [2], titled "current gas and electricity prices";
  note text not visible, so whether the page says "October 2026" cannot be confirmed. Cross-run: r2 cites a
  different page ([4] electricitycostcalc.com, "Q3 & Q4 Ofgem Rates") for 26.32p from October 2026, consistent.
- "for the same period is 26.32 pence per kWh [2]" — same period, same source.
- No past period named; nothing called current that is older.
- Verdict: **PASS.**

---

## r2-heat

Sources: [1] Heat Pump Installation Cost UK 2026: Full Price Guide — ukheatpumpservicing.co.uk; [2] Boiler
Replacement Cost UK 2026 — knowthecost.co.uk; [3] UK Utility Compliance & Procurement —
britishenergycompliance.co.uk/gas-unit-rate/; [4] Electricity Cost per Unit UK 2026 – Q3 & Q4 Ofgem Rates —
electricitycostcalc.com; [5] Air Source Heat Pump in Cold Weather UK 2026 — axiomecohomes.co.uk; [6] Heat pump
efficiency in UK climate explained — axiomecohomes.co.uk.

### AC2
- Excluded (installation / grant, not running cost): "£8,000 and £14,000 [2]", "£2,200 to £4,500 [2]",
  "£7,500 ... [1][2]", "£2,500 and £6,500 [2]", "£9,000", "£1,000 to £5,000 [2]".
- Running-cost figure (only one): "Based on these rates, a gas boiler operating at full capacity (24 kW) costs
  approximately £1.91 to run per hour [3]."
  - Kind: either (a) stated by [3], or (b) worked: 24 kW x 1 h = 24 kWh x 7.97p/kWh ("natural gas costs
    approximately 7.97p per kWh ... [3]") = 191.28p = £1.91. The arithmetic matches exactly and the report says
    "Based on these rates", so (b) is likely; both inputs and the result carry [3]. The sum itself is not written
    out in the report. Note text not visible, so I cannot say whether [3] states £1.91 or only the 7.97p and 24 kW.
  - Citation resolves: yes, [3] britishenergycompliance.co.uk/gas-unit-rate/ (read in this run).
  - No £ running-cost figure is given for the heat pump at all, and no annual figure for either system.
- Verdict: **YES (borderline).** Borderline because the only £ running cost is an hourly cost of a gas boiler at
  full 24 kW output — a per-period running cost of a heating system, so it meets the literal wording ("annual or
  per-period running cost"), but it is not a typical-home annual cost and gives the reader no £ comparison with a
  heat pump.

### AC3
- "In October 2026, the estimated gross installation cost ... £8,000 and £14,000 [2]" — current month; [2] titled
  "Boiler Replacement Cost UK 2026"; note not visible. Not a past period.
- "the unit price for electricity from October 3, 2026, is confirmed at 26.32p per kWh [4]" — names today's date
  (not a past period). [4] is titled "Electricity Cost per Unit UK 2026 – Q3 & Q4 Ofgem Rates", which supports a
  Q4 2026 rate but the specific start date "October 3, 2026" is very unlikely to come from the page (Ofgem cap
  quarters start on the 1st; 3 October is the run date given to the writer). Note not visible.
- "natural gas costs approximately 7.97p per kWh under the price cap for Direct Debit customers [3]" — present tense,
  no period named; [3] title gives no period. Not a period claim, so outside the AC3 failure condition.
- No past period is named anywhere, so nothing older is presented as current.
- Verdict: **PASS (borderline on the "from October 3, 2026" wording).** The date is today, not a past period, so the
  failure condition is not met; but it is a date the cited page almost certainly does not give.

---

## r3-heat

Sources: [1] Energy price cap unit rates and standing charges — ofgem.gov.uk; [2] Heat Pump Running Cost Calculator
2026 UK — ukcalculator.com; [3] Boiler Upgrade Scheme 2026 — £7,500 Grant Complete Guide — heatpumpcalcs.co.uk;
[4] Boiler Upgrade Scheme 2026: How to Get Your £7,500 Grant — greenhatrenewables.co.uk; [5] Heat Pumps vs Gas
Boilers Comparison (UK 2026) — heatable.co.uk; [6] Heat Pump vs Gas Boiler: Full UK Comparison (2026) —
homeheatpumpguide.co.uk.

### AC2
- £ figures present: "£7,500 [3]" / "£7,500 amount [4]" (grant), "£295 million for 2025/26 [4]" (scheme budget) —
  both excluded (not running cost).
- Running-cost figures: **none in £.** The report states usage ("8,000 to 18,000 kWh [2]") and unit rates ("26.11p
  per kWh ... 7.33p per kWh [2]") but never multiplies them, and says so: "While specific total annual bill amounts
  are not calculated in the notes".
- Verdict: **NO.**

### AC3
- "For the July–September 2026 period, the electricity unit rate is set at 26.11p per kWh, while the gas unit rate
  is 7.33p per kWh [2]." — names a past period (Q3 2026) and labels the prices with that period; it does not call
  them current. Cited [2] ukcalculator.com ("Heat Pump Running Cost Calculator 2026 UK"); note not visible, so
  whether [2] gives "July–September 2026" cannot be confirmed.
- "electricity unit prices exclude VAT during the period from October 1, 2026, to March 31, 2027 [1]" — names a
  current/future period; cited [1] Ofgem price-cap page; note not visible.
- "The figures cited represent a 4% increase over the previous quarter's rates [1]." — names no period, but read
  with the previous sentence it implies the 26.11p/7.33p figures are a new-quarter (Oct 2026 onward) rate,
  contradicting the "July–September 2026" label two paragraphs earlier.
- "the data confirms that electricity unit rates (26.11p) are significantly higher than gas unit rates (7.33p)" —
  present tense, uses the Q3 figures as the basis of the comparison without re-naming the period.
- Verdict: **PASS (borderline).** Literally, the only past period named (July–September 2026) is named as that
  period, not as current prices. Borderline because the report then uses those Q3 figures in the present tense and
  the "[1] ... 4% increase over the previous quarter" sentence muddles which quarter they belong to.

---

## r4-ev

Sources: [1] Electric Vehicle Charging Costs: Home vs Public Charging in the UK, 2026 — energybilltoolkit.co.uk;
[2] EV Charging Cost UK 2026: Home vs Public (£4.80 vs £48) — carinsuranceexpert.co.uk; [3] UK Fuel Prices: Petrol
174.9p, Diesel 200.2p — fuel-finder.uk; [4] Petrol & Diesel Prices UK Today — Live Averages — pennr.co.uk;
[5] UK Car Running Costs 2026 — Fuel, MPG & Total Ownership Guide — calchub.uk; [6] Best Fuel Efficient Cars UK
2026 — Cheapest to Run — fuel-smarter.com.

### AC2
Running-cost figures in £:
1. "The cost to run a highly efficient petrol hybrid is calculated at approximately £8.80 per 100 miles based on
   current prices [6]." — kind (a) stated by cited page [6] (no inputs/sum given in the report). Resolves: yes, [6]
   fuel-smarter.com (read in this run). Note not visible. Consistency check: at the report's own inputs, 58 MPG and
   174.9p/l, 100 miles costs 100/58 x 4.546 x £1.749 = £13.71, not £8.80; £8.80 at 58 MPG implies about 112p/l. So
   [6]'s figure is not based on the 174.9p price the report gives as today's price.
2. "For a typical annual mileage of 12,000 miles, the total running costs for electric vehicles range from
   approximately £693 to £891 using the smart tariff rate ... [5][6]" — kind: worked (b) but **mislabelled**. No sum
   is shown. Recomputing: 12,000 / 4.5 mi/kWh x 8p = £213 and 12,000 / 3.5 x 8p = £274 (smart tariff, "8p per kWh
   ... [2]"), whereas 12,000 / 4.5 x 26p = £693.33 and 12,000 / 3.5 x 26p = £891.43. So £693–£891 is worked at
   about 26p/kWh (the "26.11p per kWh [2]" price-cap rate, rounded), not "using the smart tariff rate" as stated.
   Usage input "3.5 and 4.5 miles per kWh [5]" is cited; the unit price actually used is cited at [2] elsewhere, but
   the sentence's own citations are [5][6]. Resolves: yes. Alternatively [5] may state £693–£891 directly; note not
   visible.
3. "the high-efficiency hybrid baseline of £1,056 derived from the £8.80 per 100 miles rate." — worked: £8.80 x
   (12,000 / 100) = £1,056 (correct). The sentence carries no [n] itself; its input £8.80 is cited [6]. This is
   per-distance cost x mileage, not usage x unit price.
- Verdict: **YES.** Figure 1 alone meets "stated by a cited page" (£8.80 per 100 miles [6]). Note the quality
  problems: figure 2 is labelled with the wrong tariff, and figure 1's "current prices" basis does not match the
  174.9p the report calls today's price.

### AC3
- "Based on data from October 3, 2026, the UK average price for petrol fuel is 174.9 pence per litre [3][4]." —
  today's date, not a past period. [3]'s title states "Petrol 174.9p"; [4]'s title says "Today — Live Averages".
  Supports 174.9p as a live/current figure; the exact date is not in the titles; note not visible.
- "a dedicated smart overnight tariff costs approximately 8p per kWh in October 2026 [2]" — current month; [2]
  titled "EV Charging Cost UK 2026"; note not visible.
- "The standard Ofgem price-cap electricity rate for home charging in October 2026 is 26.11p per kWh [2]." — names
  October 2026 (current). Note not visible. Cross-run evidence: r3 cites [2] ukcalculator.com for 26.11p as the
  **July–September 2026** rate, while r1 ([2] cse.org.uk) and r2 ([4] electricitycostcalc.com, "Q3 & Q4 Ofgem
  Rates") both give 26.32p for October 2026. So 26.11p is probably the previous quarter's rate, labelled here as
  October 2026.
- "£8.80 per 100 miles based on current prices [6]" — calls a price basis "current"; names no period. As computed
  above, it implies ~112p/l, not the 174.9p current price, so [6]'s "current prices" are likely older or different.
- Verdict: **PASS (borderline).** Literally the report never names a past period: every period it names is October
  2026 / 3 October 2026 (current). The failure condition ("names a past period ... as current prices") is therefore
  not met on the wording. Borderline because the substance of the failure the criterion guards against — an older
  quarter's price presented as current — very probably happened with "26.11p ... in October 2026 [2]" (by
  cross-run evidence, not by anything visible in this run's sources), and "based on current prices [6]" is not
  consistent with the report's own current petrol price. The orchestrator may wish to rule on whether a mislabelled
  date (current label on an old price) counts.

---

## Summary table

| Run | AC2 verdict | GBP running-cost figure(s) | Kind | AC3 verdict |
|---|---|---|---|---|
| r1-heat | NO | none (pence/kWh unit prices only) | — | PASS |
| r2-heat | YES (borderline: hourly, gas boiler only) | "£1.91 to run per hour [3]" (gas boiler, 24 kW) | (b) 24 kWh x 7.97p [3] = £1.91, or (a) [3]; note not visible | PASS (borderline: "from October 3, 2026 ... [4]") |
| r3-heat | NO | none (£7,500 grant and £295m budget excluded) | — | PASS (borderline: Q3 2026 rates used in present tense) |
| r4-ev | YES | "£8.80 per 100 miles [6]"; "£693 to £891 [5][6]" (EV, 12,000 mi); "£1,056" (hybrid, from £8.80 [6]) | £8.80: (a) [6]; £693–£891: (b) worked at ~26p/kWh, mislabelled as smart tariff; £1,056: worked from £8.80 [6] | PASS (borderline: 26.11p labelled "October 2026") |

**AC2: 2 of 4** (needs at least 3 — M19j-AC2 is not met on these four reports).

**AC3: 4 of 4 pass** (literal reading; three borderline calls listed above).

---

## Owner's opinion of report quality: pending (to be recorded by the orchestrator)
