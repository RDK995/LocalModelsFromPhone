# M19j-T12 — judgement of the M19j-T11 re-run reports against M19j-AC2 and M19j-AC3 (+ extra 2008 check)

Commit at judgement: 64a2d77, HEAD moved to 01809e0 during the task (branch m19j-live-priced-reports); the T11 streams were extracted and byte-checked as found in the working tree. Today: 2026-10-03.
Only the M19j-T11 runs are judged (r1-heat, r2-heat, r3-heat, r4-ev; r5-gfc2008 = owner's extra, non-gating).

## How the reports were extracted and checked

- Each `.harness/evidence/M19j-T11-<RUN>-stream.txt` was parsed with a verbatim JS copy of `parseSse`
  (server/scripts/ac29-live-run.ts lines 42-65, TypeScript annotations stripped) in a one-off scratch script outside
  the repository. (Importing the script directly was not done: it has top-level code that contacts the server.)
  Report text = concatenation of every `content` event's `data.text` (each run has exactly one `content` event);
  sources = the `sources` event's `items` (n, title, url).
- Written to `.harness/evidence/M19j-T12-<RUN>-report.md` between `<!-- REPORT-BEGIN -->\n` and
  `\n<!-- REPORT-END -->`, followed by the numbered sources list.
- Independent check: a separate Python script re-decoded the raw stream (`json.loads` of the `data:` line of each
  `event: content` block) and the text between the markers was cut out of each report.md; the two were compared with
  `cmp` (byte comparison) and sha256:
  - r1-heat: 2365 bytes, IDENTICAL, sha256 ad9379682746c631...
  - r2-heat: 2787 bytes, IDENTICAL, sha256 500c46e9b880cf02...
  - r3-heat: 1825 bytes, IDENTICAL, sha256 9d32c4a03119a4fd...
  - r4-ev: 2487 bytes, IDENTICAL, sha256 40d813c856d30842...
  - r5-gfc2008: 3112 bytes, IDENTICAL, sha256 a12802f36b684ddc...

## What source / note text was visible

The streams carry only: `step` events (fields step_id, kind, status, elapsed_ms, budget_ms, and `query` for searches,
`url` for reads, `detail` such as "Taking notes: octopus.energy", "fetch_failed", "unsupported_content"), one
`content` event, one `sources` event (n, title, url only) and one `done` event (status, model, eval_count,
tokens_per_second, research). The fr41.log files carry only per-model-call timing/count fields (step, think, attempt,
wall_ms, eval_count, thinking_chars, outcome) and a run-end line (notes_kept, pages_read). **No note text, passage
text, page text, plan text or sub-question text is present in any saved artefact.** Every "does the cited note give
it" check below can therefore only be made against the cited source's title and URL (plus the search queries the run
issued). Nothing was fetched; no server/Ollama/web contact. "Note not visible" below always means this.

Citation resolution: every [n] in every report resolves to an entry in that report's sources list (result.json
`unresolved_citations: []` for all five; confirmed by reading). Cited-in-text sets: r1 [1][2][4][5][6] (source [3]
listed, not cited); r2 [1]-[6]; r3 [1][2][5][6] ([3],[4] listed, not cited); r4 [1]-[4]; r5 [2]-[5] ([1] listed, not
cited).

---

## r1-heat

Question: "How do heat pumps compare with gas boilers for heating a typical UK home in 2026? Cover running costs,
installation costs, grants available and how well they work in cold weather."

Sources: [1] Gas Boiler Installation Cost UK 2026 (bestbuilders.co.uk); [2] Install a heat pump
(cleanenergy.campaign.gov.uk); [3] Energy Price Cap Per kWh Explained (2026) (freepricecompare.com); [4] Energy prices
from October 2026, and what they mean for you (octopus.energy); [5] Air Source Heat Pump in Cold Weather UK 2026
(axiomecohomes.co.uk); [6] Cold snap shows heat pump efficiency, research reveals (hpmmag.com).

### AC2 — GBP running-cost figure with a citation

GBP running-cost figures found: **none.** Every £ amount in the report is an installation cost or a grant:
- "standard gas combi swaps ranging from £1,800 to £3,500 [1]", "between £2,500 and £4,000", "from £2,500 to £4,200
  [1]", "£3,500 to over £5,500 [1]", "an extra £300 to £600 to gas boiler installation costs [1]" — installation.
- "a £7,500 grant ... rising to £9,000 [2]", "This enhanced grant of £9,000 ... [2]" — grant.

The running-cost paragraph gives only percentages: "natural gas unit prices have risen by 8.7%, whereas electricity
unit rates have increased by only 0.2% [4]" and "average dual-fuel energy bills are projected to increase by
approximately 4% starting October 1, 2026 [4]", and states "the provided notes do not supply a specific kWh quantity
for a typical home's annual usage". No unit price in pence and no £ per year appear.

Kind: n/a. **Verdict: NO.**

### AC3 — no past period named as current prices without a cited note giving it

Period/date/"current" mentions for prices:
1. "Installation costs for typical UK heating systems in 2026 vary by type ... [1]" — current year; source [1] title
   "Gas Boiler Installation Cost UK 2026" gives 2026. Not a past period.
2. "This enhanced grant of £9,000 remains available for qualifying installations until March 2027 [2]" — a grant
   deadline, not a price period; source [2] title "Install a heat pump" does not show the date (note not visible).
   Not a past period presented as current.
3. "Regarding running costs and unit prices as of October 2026, natural gas unit prices have risen by 8.7% ... [4]" —
   current month; source [4] title "Energy prices from October 2026, and what they mean for you" gives October 2026.
4. "average dual-fuel energy bills are projected to increase by approximately 4% starting October 1, 2026 [4]" —
   same source, title gives October 2026.

No past period is named as current prices. **Verdict: PASS.**

---

## r2-heat

Question: same heat-pump question as r1.

Sources: [1] Heat Pump Installation Cost 2026: UK Price Guide (bestbuilders.co.uk); [2] Air Source Heat Pump Cost in
2026: Installation, Running & Net Price After the Grant (boilercoveruk.co.uk); [3] UK Utility Compliance & Procurement
(britishenergycompliance.co.uk/electricity-unit-rate/); [4] Heat Pump vs Gas Boiler 2026: Costs, Savings & Comparison
(ukhomeenergy.co.uk); [5] Heat pumps in cold weather UK winter performance (axiomecohomes.co.uk); [6] Do Heat Pumps
Work in UK Winter? 2026 Cold Weather Perfor... (heatpumpcompared.co.uk).

### AC2

GBP running-cost figures found (verbatim):
- "To provide a concrete running cost comparison: assuming a typical home requires 12,000 kWh of heat annually, a gas
  boiler (90% efficient) would cost approximately £1,067 per year, while an ASHP with a SCOP of 3.5 would cost
  approximately £848 per year [4][3]."

Inputs quoted elsewhere in the report: "a heat pump operating with a Seasonal Coefficient of Performance (SCOP) of 3.5
delivers heat at approximately 7.5p per kWh, compared to 8.9p per kWh for a standard 90% efficient gas boiler [4]";
"The average electricity unit price across UK regions for Direct Debit customers under the October 2026 price cap is
26.32p/kWh, quoted without VAT [3]".

Kind: presented as **(b) worked**: usage "12,000 kWh of heat annually" x per-kWh-of-heat cost. Citations [4][3] both
resolve (ukhomeenergy.co.uk, britishenergycompliance.co.uk), both pages were read in the run.
- Arithmetic check, gas: 12,000 x 8.9p [4] = £1,068 — consistent with "£1,067" (rounding of the 8.9p input).
- Arithmetic check, heat pump: 12,000 x 7.5p [4] = £900; 12,000 / 3.5 x 26.32p [3] = £902.40. Neither gives "£848"
  (£848 implies ~7.07p per kWh of heat, or ~24.7p/kWh electricity at SCOP 3.5). So £848 is not reproducible from
  the inputs the report quotes; it may be stated on page [4] (whose title "Costs, Savings & Comparison" makes that
  plausible), but the note is not visible, so this cannot be confirmed.
- The usage figure is introduced as "assuming"; it sits inside the sentence carrying [4][3], but the report does not
  say which page gives 12,000 kWh. Note not visible.

**Verdict: YES (borderline).** Reason: a GBP running-cost figure carrying resolving citations is given, and the gas
figure (£1,067) is arithmetically consistent with the cited 8.9p/kWh-of-heat [4] and the stated 12,000 kWh. Borderline
because (1) the usage is framed as an assumption without a dedicated citation, and (2) the heat-pump figure £848 does
not follow from the report's own cited inputs (expected ~£900). If the reviewer requires the worked sum to reproduce
from cited inputs for every figure, the gas figure still passes and the heat-pump figure does not.

### AC3

1. "### Comparison of Heat Pumps and Gas Boilers for UK Homes (2026)" — current year heading.
2. "In the period from 1 October to 31 December 2026, a heat pump ... approximately 7.5p per kWh, compared to 8.9p per
   kWh ... [4]" — the current quarter (today 2026-10-03), not a past period. Source [4] title says "2026" only; the
   exact quarter is not confirmable (note not visible).
3. "alongside the removal of VAT on electricity consumption from 1 October to 31 March 2027 [4]" — current/future
   period; title "2026" only.
4. "under the October 2026 price cap is 26.32p/kWh, quoted without VAT [3]" — current month; source [3] title "UK
   Utility Compliance & Procurement" does not give a period (note not visible). Current, not past.
5. "During the 2025–26 winter, average temperatures in England were 4.5°C [5]" — a past period, but about weather, not
   prices.
6. Installation costs/grant: no period stated beyond the heading.

No past period is named as current prices. **Verdict: PASS.** (Note: items 2-4 cannot be confirmed against note text,
but none is a past period, so the failure condition is not met.)

---

## r3-heat

Question: same heat-pump question as r1.

Sources: [1] Air Source Heat Pump Cost UK 2026: Prices, Grants & Running Costs (expertsure.com); [2] Boiler
Replacement Cost UK 2026 (knowthecost.co.uk); [3] Heat Pump vs Gas Boiler Running Costs UK 2026 (pocketwise.co.uk) —
not cited; [4] Energy Price Cap October 2026: Confirmed at £1,723 a Year (lookinto.co.uk) — not cited; [5] Heat Pump
SCOP Explained: UK 2026 Buyer's Guide (heatpumphq.co.uk); [6] Can heat pumps cope with UK winter temperatures?
(axiomecohomes.co.uk).

### AC2

GBP running-cost figures found: **none.** £ amounts are installation or grant: "between £8,000 and £16,500", "between
£2,200 and £4,500 [1][2]", "between £3,500 and £6,000 [1]", "£2,500 for air-to-air heat pump installations [1][2]".
The report states explicitly: "The notes do not provide specific retail unit prices for electricity or natural gas per
kWh for October 2026, nor do they state a typical annual consumption figure in kWh for a home; consequently, a
calculated running cost figure in pounds sterling cannot be derived from the provided sources." (uncited).
Source [4]'s title contains "£1,723 a Year" (a price-cap household bill), but the report neither cites [4] nor states
that figure, so it does not count.

Kind: n/a. **Verdict: NO.**

### AC3

1. "As of October 2026, the average installation cost for an air-to-water heat pump in the UK is between £8,000 and
   £16,500, whereas a typical gas boiler replacement costs between £2,200 and £4,500 [1][2]" — current month; titles
   of [1] and [2] give "2026" (not the month; note not visible). Not a past period.
2. "the Energy Company Obligation (ECO4) scheme offers funding ... until December 2026" and "VAT, which is currently 0%
   on heat pump installations until March 2027 [1]" — scheme/tax deadlines, current/future.
3. "The notes do not provide specific retail unit prices for electricity or natural gas per kWh for October 2026" —
   names the current month for prices, stating none was found; uncited; not a past period.

No past period is named as current prices. **Verdict: PASS.**

---

## r4-ev

Question: "What does it cost to run an electric car compared with a petrol car in the UK in 2026? Cover charging and
fuel costs per year for typical mileage."

Sources: [1] Zapmap Price Index - Average weighted price to charge on the public network (zapmap.com); [2] UK Public EV
Charging Costs in 2026: Price Guide (beny.com); [3] Most Efficient Electric Cars in the UK by Miles Per kWh
(evcompared.co.uk); [4] Most Efficient Electric Cars UK 2026 (Miles per kWh) (bestchargers.co.uk).
Both petrol pages (fuelfinderlive.co.uk x2) failed to fetch (`fetch_failed`), so no petrol source exists.

### AC2

GBP running-cost figures found (verbatim):
1. "This results in an annual cost of approximately £480 to £530 for 10,000 miles at standard home rates [4]."
   Inputs: "Using the standard electricity rate of approximately 24p-26p per kWh, an efficient EV delivering 5.0 miles
   per kWh (mi/kWh) costs around 4.8p to 5.3p per mile [4]". Check: 10,000 x 4.8p = £480; 10,000 x 5.3p = £530
   (24p/5.0 = 4.8p; 26.5p/5.0 = 5.3p). Consistent.
2. "a less efficient EV delivering 3.5 mi/kWh costs around 6.9p per mile under the same conditions, totaling
   approximately £690 annually [4]." Check: 24p/3.5 = 6.86p; 10,000 x 6.9p = £690. Consistent.
3. "Under a low off-peak home tariff of 5.49p/kWh, a 5.0 mi/kWh car costs 1.10p per mile, resulting in an annual cost
   of £110 for 10,000 miles, while a 3.0 mi/kWh car costs 1.83p per mile, totaling £183 [3]." Check: 5.49/5.0 =
   1.098p, x10,000 = £110; 5.49/3.0 = 1.83p, x10,000 = £183. Consistent.
4. Differences (not running costs themselves, listed for completeness): "exceeds £200 per year for this distance [4]",
   "approximately £73 annually [3]", "the efficiency gap alone worth over £1,000 per year in savings [3]".

Kind: each figure carries a single page citation with its per-mile and unit-price inputs attributed to the same page,
so the most literal reading is **(a) stated by a cited page** ([4] bestchargers "Miles per kWh" guide; [3] evcompared
"Miles Per kWh"); it can equally be read as **(b) worked**: usage = 10,000 miles a year (the question's "typical
mileage"; not separately cited) x cited per-mile cost from cited unit price and cited mi/kWh. Either way, every
arithmetic check above reproduces. All citations resolve; pages [3] and [4] were read. Note text not visible, so
whether the £ figures appear verbatim on the pages cannot be confirmed.

**Verdict: YES.** Borderline aspect (not affecting the literal verdict): figures exist only for the EV; the report says
"The provided notes do not contain specific data regarding projected UK petrol fuel prices per litre for 2026 or any
calculated annual operating costs for petrol vehicles" and "the specific petrol cost figure is not available in the
source notes [4]", so only one of the two compared options has a running-cost figure. AC2 as written requires "a GBP
running-cost figure", which is met.

### AC3

1. "Based on projections for 2026 in the UK, the annual operating costs ..." — current year (oddly framed as
   "projections"); uncited; not a past period.
2. "Projected electricity costs for home charging in 2026 range from off-peak rates of around 8.5p/kWh to standard
   tariffs averaging approximately 26p/kWh [1]" — current year; source [1] (Zapmap Price Index) title gives no period;
   note not visible. Not a past period.
3. "off-peak rates dropping to between 7p and 10p per kWh in 2026 [2]" — source [2] title gives "in 2026".
4. "some sources cite a blended all-charger average of approximately 75p per kWh in 2026 [1][2]" — [2] title gives
   2026.
5. "Under a low off-peak home tariff of 5.49p/kWh ... [3]" and "public rapid chargers at 79p/kWh [3]" — no period named.
6. "Even at peak tariff times in late 2026 (approx. 26.32p/kWh), an EV's running cost of around 5.3p per mile remains
   significantly lower than a petrol equivalent ... [4]" — "late 2026" is now/current (Q4 2026); source [4] title
   gives "2026" only, not "late"; note not visible.

No past period is named as current prices. **Verdict: PASS.** Borderline note: items 2 and 6 attach "2026"/"late 2026"
to figures whose cited page titles do not (or only partly) show that period; since the period named is the current
one, not a past one, this does not meet the failure condition, but the period attribution cannot be verified.

---

## Summary table (M19j-AC2, M19j-AC3)

| Run | AC2 verdict | GBP running-cost figure(s) | Kind | AC3 verdict |
|---|---|---|---|---|
| r1-heat | NO | none (only installation £ and grants; running costs given as % changes) | n/a | PASS |
| r2-heat | YES (borderline) | "£1,067 per year" (gas), "£848 per year" (ASHP) [4][3] | (b) worked from "12,000 kWh" (assumed, under the [4][3] citation) x 8.9p / 7.5p per kWh of heat [4]; £1,067 reproduces, £848 does not (expected ~£900) | PASS |
| r3-heat | NO | none ("a calculated running cost figure in pounds sterling cannot be derived") | n/a | PASS |
| r4-ev | YES | "£480 to £530", "£690" [4]; "£110", "£183" [3] (EV only; no petrol figure) | (a) stated by cited page, or (b) 10,000 miles (question's typical mileage) x cited p/mile; all sums reproduce | PASS |

**AC2: 2 of 4** (r2-heat, r4-ev) — below the required "at least 3 of the 4". M19j-AC2 is NOT met.
(If the borderline r2 call were ruled NO, AC2 would be 1 of 4; it cannot reach 3 of 4 on any reading.)

**AC3: 4 of 4 pass.** M19j-AC3's per-report check is met (owner's opinion still to be recorded, below).

---

## r5-gfc2008 — owner's extra check (2026-10-03; NOT an acceptance criterion, does not gate)

Question: "What caused the 2008 financial crisis?" Sources: [1] 2008 financial crisis (en.wikipedia.org) — not cited;
[2] Subprime Crisis of 2007—2009: What Happened and Why (investopedia.com); [3] Securitization's Impact on the 2008
Global Financial Crisis (investopedia.com); [4] 2008 Financial Crisis Regulatory Failures · The 2008 Financial Crisis
Causes Consequences and Global Impact (learningwhistle.com); [5] The Legislative Roots of the 2008 Housing Crash ...
(linkedin.com). One page (ijnrd.org PDF) failed with `unsupported_content`.

(i) A price or cost section/heading: **none found.** The report has no headings at all (four plain paragraphs: causes
overview; leverage/securitisation; regulatory failure/legislation).

(ii) A current-unit-prices sub-question: **plan / sub-question text is not visible** — neither the stream nor
M19j-T11-r5-gfc2008-fr41.log contains it (fr41 shows only that the plan step ran: think:true attempt 1 hit the guard,
think:false attempt 2 "ok" with eval_count 106; plus a brief call). What is visible are the six search queries the run
issued, none of which concerns prices: "subprime mortgage bubble expansion and collapse timeline 2008"; "how subprime
defaults triggered 2008 financial crisis"; "how excessive leverage amplified 2008 financial crisis losses"; "impact of
mortgage-backed securities on financial institutions 2008"; "failures of regulatory oversight in 2008 financial
crisis"; "SEC deregulation role in 2008 housing bubble". The report's paragraphs match three topics (subprime bubble,
leverage, regulatory oversight), consistent with no price sub-question, but this is inference, not the plan text.

(iii) A statement like "no current price was found": **none found.**

Historical money amounts / prices that are part of the crisis narrative (not misplaced price content):
- "These assets were used as leverage to control many trillions of dollars, which were many times the face value of
  the underlying assets [3]."
- "banks that held these securitizations as investments lost tens of billions of dollars which almost caused the US
  banking system to collapse [3]."
- Narrative price references without amounts: "a real estate bubble with fast-rising home prices that fell sharply
  [2]"; "risky mortgage products that offered low introductory rates but sharp payment increases over time [5]".

Result of the extra check: no misplaced price/cost content found in r5-gfc2008.

---

## Owner's opinion of report quality: pending (to be recorded by the orchestrator)
