# Free web search API tiers usable by local LLMs (as of 2026-09-29)

Research date: 2026-09-29. "Accessed" = fetched/searched on that date. Primary sources (vendor pages/docs) are preferred; secondary sources (aggregators, blogs) are flagged. The user will not pay, so "card required" counts against an option.

## Summary table

| Provider | Free allowance | Card at signup? | Rate limits (free) | Privacy / retention | AI/LLM-use or storage terms | Free-tier stability |
|---|---|---|---|---|---|---|
| **Ollama web_search / web_fetch** | "Generous free tier" — **no published number** | No (free Ollama account + API key) | Not published | Not documented for search | None found forbidding LLM use (built for it) | Launched 2025-09-24; unquantified; Ollama Cloud limits reshaped in 2026 |
| **Exa** | $10 credit at signup + resets to $10 on 1st of each month ("up to 2,500 Instant searches") | No | Not stated on pricing page | ZDR is enterprise-only | Built for AI agents | Recurring monthly credit; figures differ across secondary sources |
| **Tavily** | 1,000 credits/month ("Researcher") | No | Not confirmed | May use query data to improve service; may share queries with third-party index providers | Built for AI agents | Stable since launch; requests stop at cap (no surprise bill) |
| **Jina r.jina.ai (reader)** | Keyless: free at 20 RPM; with key: 10M free tokens per new key | No | 20 RPM keyless; 500 RPM with free key | "Never use your API requests... to train"; 5-min URL cache | — | Keyless reader long-standing |
| **Jina s.jina.ai (search)** | Needs key; draws on 10M free tokens (one-time, per key); min 10,000 tokens/search ≈ ≤1,000 searches | No | 100 RPM with free key; **blocked without key** | Same as above | — | Token grant is one-time, not monthly |
| **LangSearch** | $0 plan, token prices "$0"; daily token allowance | Not stated (believed no) | Docs: 5 RPS for new accounts + TPM/TPD caps; secondary: 1 QPS / 60 QPM / 1,000 QPD (conflict) | Not documented | Marketed as "Free Web Search API for AI agents" | Small Chinese-run startup, "free while we build AGI" — sustainability uncertain |
| **Linkup** | $20 credit on signup, topped back to $20 monthly (~4,000 standard searches at $0.005) | Not mentioned; **requires professional email** | Not stated | Not stated | Built for AI | Unknown history |
| **You.com Web Search API** | 100 calls/day free (added 2026-07-29) + $100 signup credit (secondary) | Secondary sources say no card for $100 credit | 100/day | Not researched | Built for AI | Brand-new (July 2026); docs lagged the pricing page |
| **Brave Search API** | $5 credit/month (~1,000 queries at $5/1k) | **Yes — card required** | 50 QPS on Search plan | Offers ZDR; storage of results for LLM training needs a plan with explicit storage rights | Storing results (e.g., to train/tune an LLM) not allowed on general ToS | **Free 2,000-query plan ended 2026-02-12**; card now meters overage |
| **Serper.dev** | 2,500 queries **one-time** | No | Not researched | Google SERP proxy | — | One-time trial, not recurring |
| **SerpApi** | 250 searches/month recurring | No | 50 searches/hour | Google SERP proxy | — | Recurring (secondary sources) |
| **Mojeek API** | "Free trial version, with limited queries" — amount unpublished, contact required | Paid plans via Stripe PAYG (card) | Paid: 5 QPS / 100k/day (Startup) | Independent index; see privacy policy | "Yes, you can use the API results for AI with all plans"; storage rights included | Trial only; not a real free tier |
| **Google Custom Search JSON API** | Was 100/day free | Needed GCP project | — | — | — | **Closed to new customers; shuts down 2027-01-01** |
| **Bing Web Search API** | None | — | — | — | — | **Retired 2025-08-11** (410 Gone) |
| **Perplexity Sonar** | No permanent free tier (secondary) | Yes — payment method to create key | — | — | — | Not free |
| **DuckDuckGo Instant Answer API** | Free, keyless | No | Unpublished | — | — | Works, but **not a web search API** (instant answers only) |

## Key question 1: Exact current free limits and card requirements (as of 2026)

### Takeaway
Card-free recurring free tiers exist at Tavily (1,000 credits/mo), Exa ($10/mo), Linkup ($20/mo, pro email), You.com (100/day), SerpApi (250/mo), LangSearch (free, daily-capped) and Ollama (free account, unquantified). Brave now requires a card and bills overage; Google CSE and Bing are dead or dying.

### Cited Findings

**Ollama web search / web fetch**
- Docs: "For access to Ollama's web search API, create an API key. A free Ollama account is required." `max_results` defaults to 5, max 10. No numeric free quota stated. — [Ollama docs: Web search](https://docs.ollama.com/capabilities/web-search) (accessed 2026-09-29)
- Launch blog (2025-09-24): "Ollama provides a generous free tier of web searches for individuals to use, and higher rate limits are available via Ollama's cloud." / "Web search is included with a free Ollama account, with much higher rate limits available by upgrading your Ollama subscription." No numbers, no retention statement. — [Ollama blog: Web search](https://ollama.com/blog/web-search)
- Pricing page: Free $0 — "Starter usage credits included," starter models, 1 concurrent request; Pro $20/mo with $60 monthly usage credits; Max $100/mo with $300 credits; Team $500/mo. Model pricing is per million tokens with off-peak pricing. **The pricing page does not mention web search at all**, so there is no stated link between "usage credits" and search calls. — [ollama.com/pricing](https://ollama.com/pricing) (accessed 2026-09-29)
- Third party: Ollama "does not publicly list RPM/TPM... as of 25 September 2026"; Free plan "includes a small amount of monthly usage... reset monthly from your signup date... There are no 5-hour or weekly limits anymore." — [ollamatps.com/limits](https://ollamatps.com/limits/) (secondary); contradicted by older reports of 5-hour session / 7-day weekly limits and 429 "you have reached your weekly usage limit" — [DEV Community](https://dev.to/amareswer/ollama-cloud-free-vs-pro-usage-limits-pricing-what-you-actually-get-2026-3ieo), [hermes-agent issue #65563](https://github.com/NousResearch/hermes-agent/issues/65563) (these concern cloud model inference, not specifically search)

**Exa**
- "$10 in credits (up to 2,500 Instant searches)" at signup; balance resets to "$10 on the first of every month"; no payment method required. Instant search $4/1k; fast/auto $7/1k; +$1/1k per result beyond 10; Contents $1/1k pages. Custom rate limits and ZDR are enterprise-only. — [exa.ai/pricing](https://exa.ai/pricing) (accessed 2026-09-29)
- Secondary sources give different figures ("$20 on sign-up plus $10 per month"; "~1,400 searches") — [UsagePricing](https://www.usagepricing.com/blueprint/exa-ai), [fastcrw](https://fastcrw.com/blog/exa-pricing-explained). Treat the vendor page as authoritative.

**Tavily**
- Free "Researcher" plan: 1,000 API credits/month, no credit card; requests stop when exhausted until reset. Paid from $30/mo (4,000 credits) or PAYG $0.008/credit. — [Tavily pricing](https://www.tavily.com/pricing); corroborated by [AgentDeals](https://agentdeals.dev/vendor/tavily-ai), [TokenMix](https://tokenmix.ai/blog/tavily-ai-api-pricing-2026-credits-rate-limits) (secondary). Note: basic search = 1 credit, advanced search = 2 credits (from memory of Tavily docs — not re-verified this session).

**Jina**
- r.jina.ai: 20 RPM with no key; 500 RPM with free key; 5,000 RPM premium. s.jina.ai: **blocked without key**; 100 RPM with free/paid key. Search bills a minimum of 10,000 tokens/request. "Every new API key comes with 10M free tokens!" — [jina.ai/reader](https://jina.ai/reader/) (accessed 2026-09-29)
- Inference: 10M tokens / 10k-token minimum ≈ at most ~1,000 searches from the free grant, and it is a one-time grant per key, not monthly.

**LangSearch**
- Docs: Free plan "$0 / month", "All supported Web Search features included"; "New accounts start at 5 RPS"; limits metered as TPM and TPD, daily reset 00:00 UTC; input/output tokens "$0 per million". — [LangSearch API limits](https://docs.langsearch.com/limits/api-limits) (accessed 2026-09-29)
- Search-engine snippet of the same/older docs: "1 QPS, 60 QPM, 1000 QPD" on free tier; up to 50 results/request. — [LangSearch docs (search snippet)](https://docs.langsearch.com/limits/api-limits); **conflicts** with the fetched page (5 RPS + token caps). Likely changed; flag.

**Linkup**
- "When you first sign up with a professional email address, your account is automatically credited with $20. We will top up eligible accounts back to $20 each month." Standard search $0.005 (raw) / $0.006; deep $0.05–0.055. Also x402 USDC pay-per-request option. — [Linkup pricing docs](https://docs.linkup.so/pages/documentation/platform/pricing) (accessed 2026-09-29). Card requirement not mentioned. The "professional email" rule may exclude gmail-type addresses.

**You.com**
- 2026-07-29: Web Search API gained "Free / 100 calls per day" before $5/1k applies; previously only a $100 account credit. Search API docs had not yet been updated. — [UsagePricing change log](https://www.usagepricing.com/blueprint/activity/you-com-2026-07-29-web-search-free-tier) (secondary, based on pricing-page diff)
- "$100 in complimentary credits—no credit card required"; MCP server free tier 100 queries/day with no signup — search summary of [You.com docs/quickstart](https://you.com/docs/quickstart) and [You.com lower-cost page](https://you.com/resources/lower-search-api-cost) (not fetched directly — verify).

**Brave Search API**
- Current: Search $5/1k requests, "Includes $5 in free credits every month", 50 QPS; Answers $4/1k + tokens, $5 free credits, 2 QPS. Card required "as an anti-fraud measure" — page text still says for free plans "the card is only used to confirm your identity and will not be charged." — [brave.com/search/api](https://brave.com/search/api/) (accessed 2026-09-29)
- Change: free 2,000-query plan (raised to 5,000 in the Aug 2025 AI Grounding update per one source) ended 2026-02-12, replaced by $5 monthly credit (~1,000 searches); the card on file now bills overage with no spending cap. — [Implicator.ai](https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/); nuance ("it became $5 of free credit a month") — [agentdeals issue #1931](https://github.com/robhunter/agentdeals/issues/1931). **Conflict:** Brave's own page wording ("will not be charged") vs reports that overage is billed; the practical risk is that a card is live on file.

**Serper.dev** — 2,500 free queries, no card, **one-time** (top-up credit model, no subscription). — [costbench](https://costbench.com/software/web-scraping/serper/free-plan/), [FreeAPIHub](https://freeapihub.com/apis/serper-api) (secondary; vendor page not fetched)

**SerpApi** — 250 searches/month recurring, no card, 50 searches/hour throughput. — [scrapegraphai](https://scrapegraphai.com/blog/serpapi-pricing), [agntn/web issue #205](https://github.com/agntn/web/issues/205) (secondary; vendor page not fetched)

**Mojeek** — Startup £2 CPM PAYG (5 QPS, 100k/day), Business £3 CPM; "Free trial version, with limited queries" (amount unstated, contact needed); payment "With Stripe on a pay-as-you-go credit system". — [Mojeek Web Search API](https://www.mojeek.com/services/search/web-search-api/) (accessed 2026-09-29)

**Google Custom Search JSON API** — Announced Jan 2026: discontinued 2027-01-01; already closed to new customers; Google points to Vertex AI Search (~$2/1k, searches your own content/up to 50 domains, not the public SERP). — [DEV Community](https://dev.to/nexgendata/google-kills-custom-search-api-on-jan-1-2027-you-have-9-months-1jg1), [Octoparse](https://www.octoparse.com/blog/google-official-search-api), [Google CSE overview](https://developers.google.com/custom-search/v1/overview), [Google migration doc](https://cloud.google.com/generative-ai-app-builder/docs/migrate-from-cse?hl=it)

**Bing Web Search API** — Retired 2025-08-11; new resources disabled Feb 2025; endpoints return 410; replacement "Grounding with Bing Search" in Azure AI Agents (agent context, not raw results; paid Azure). — [Microsoft Learn lifecycle](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)

**Perplexity Sonar** — No permanent free tier; free users get zero credits and must add a payment method to create an API key; token + per-request pricing. — [yangmao.ai](https://yangmao.ai/en/providers/perplexity/free-api/), [CloudZero](https://www.cloudzero.com/blog/perplexity-api-pricing/) (secondary). Note: Perplexity Pro subscribers historically received $5/mo API credit (not re-verified; irrelevant to a non-paying user).

**DuckDuckGo Instant Answer API** — Free, no key, no formal rate limit, but returns only instant answers/related topics, not web result lists. — [iproyal guide](https://iproyal.com/blog/duckduckgo-api/), [FreeAPIHub](https://freeapihub.com/apis/duckduckgo-instant-answer-api) (secondary)

### Inferences
- For a local LLM, the most useful card-free budget per month (rough): Linkup ~4,000 searches (if pro email accepted), You.com ~3,000 (100/day), Exa ~1,400–2,500, Tavily 1,000, SerpApi 250, LangSearch daily-capped but nominally free, Ollama unknown. Stacking several behind a fallback chain is realistic.
- Ollama's search is the natural fit for Ollama-hosted local models (native tool in the Ollama Python/JS libraries), but its quota is opaque; a user will only discover the cap by hitting 429s.
- Jina keyless reader (r.jina.ai, 20 RPM) is the best no-signup "fetch a page" tool; it doesn't solve search.

### Gaps
- Ollama: no official number for free web_search/web_fetch calls, and no statement on whether search consumes the "usage credits" on the pricing page. I found no primary source; community reports concern model inference limits, not search.
- Tavily/Exa/You.com/Linkup free-tier rate limits (RPM) not confirmed from primary sources.
- LangSearch: conflicting limit descriptions (1 QPS/1,000 QPD vs 5 RPS + token caps); card requirement unstated.
- Mojeek free-trial quantity unpublished.

## Key question 2: Which are most likely to remain free and usable without a card?

### Takeaway
Best bets: Tavily (long-running 1,000/mo, no card, hard stop at cap), Exa (vendor-published monthly reset, independent index), Jina reader keyless, and Ollama (tied to Ollama's own product strategy). Riskier: LangSearch (tiny startup, "free while we build AGI"), You.com (100/day just added July 2026), Linkup (pro-email gate). Already failed: Brave (card + metering since Feb 2026), Google CSE (ends 2027-01-01), Bing (gone).

### Cited Findings
- Brave converted its free plan to $5 credit with card billing on 2026-02-12 — [Implicator.ai](https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/)
- Google CSE closed to new customers, ends 2027-01-01 — [DEV Community](https://dev.to/nexgendata/google-kills-custom-search-api-on-jan-1-2027-you-have-9-months-1jg1)
- Bing Search APIs retired 2025-08-11 — [Microsoft Learn](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)
- Tavily: when credits run out "requests will stop until your credits reset or you upgrade" — [Tavily pricing](https://www.tavily.com/pricing) via search summary; [AgentDeals](https://agentdeals.dev/vendor/tavily-ai)
- You.com's free daily quota appeared 2026-07-29 — [UsagePricing](https://www.usagepricing.com/blueprint/activity/you-com-2026-07-29-web-search-free-tier)
- LangSearch pricing page tagline "Free access as we build AGI together" — [LangSearch pricing](https://langsearch.com/pricing) (title from search results)
- Ollama: "Web search is included with a free Ollama account" — [Ollama blog](https://ollama.com/blog/web-search)

### Inferences
- Pattern of 2025–2026: providers that resell/wrap big-engine results (Bing, Google, Brave's generosity) cut free access; AI-native search startups (Tavily, Exa, Linkup, You.com) are still using free credit as customer acquisition, so free tiers persist but numbers change often.
- A no-card tier is structurally safer for this user: the worst case is a 429/refusal, never a bill. Brave now fails this test.
- Build the harness with a pluggable provider list and fallback; do not hard-depend on any single free tier.

### Gaps
- No provider publishes a commitment to keep the free tier; stability judgements are inference from history.

## Key question 3: Privacy — is query data logged/used for training? Terms forbidding LLM/AI use or storage?

### Takeaway
Most providers log queries; zero-data-retention is typically enterprise-only (Exa, Brave). Tavily's policy allows using query data to improve the service and sharing with third-party indexes. Jina says it never trains on API requests. Brave's ToS forbids storing results (e.g., for LLM training) without a storage-rights plan; Mojeek explicitly allows AI use with storage rights. Ollama's search privacy is undocumented.

### Cited Findings
- Tavily "may use portions of query data to improve responses to future queries" and may share query data with third-party search index providers; zero-day retention only under enterprise agreements; policies are internally inconsistent on retention. — [Tavily Privacy Policy](https://www.tavily.com/privacy), [Tavily Help: data retention](https://help.tavily.com/articles/6781493822-data-retention), [AIRIN](https://airinetwork.com/platform/tavily) (search summaries; not fetched in full)
- Exa announced ZDR across search products (Aug 2025), but pricing page lists ZDR as an enterprise feature. — [Exa blog](https://exa.ai/blog/zdr-search-engine), [exa.ai/pricing](https://exa.ai/pricing)
- Jina: "We never use your API requests, inputs, or outputs to train our embedding, reranker, or any other models"; Reader caches same URL for 5 minutes. — [jina.ai/reader](https://jina.ai/reader/)
- Brave: storing results "for example, to train or tune an LLM" requires a plan that "explicitly grants storage rights"; ZDR offered (full-funnel ZDR on Enterprise). — [brave.com/search/api](https://brave.com/search/api/)
- Mojeek: "Yes, you can use the API results for AI with all plans"; all plans include storage rights (1-hour caching on lower tiers). — [Mojeek Web Search API](https://www.mojeek.com/services/search/web-search-api/)
- Ollama: blog and docs contain no data-retention statement for web search. — [Ollama blog](https://ollama.com/blog/web-search), [Ollama docs](https://docs.ollama.com/capabilities/web-search)
- Serper/SerpApi return Google results; Exa notes most search APIs "wrap Google" and "cannot offer ZDR since Google trains on user queries" (vendor's marketing claim). — [Exa blog](https://exa.ai/blog/zdr-search-engine)

### Inferences
- For a local-first, privacy-minded setup: Jina (explicit no-training) and Mojeek (independent UK index, AI use allowed, but no real free tier) are the cleanest on paper; Tavily is the weakest on paper among the AI-native options.
- Using search results as transient LLM context (not stored/trained) generally falls outside "storage" restrictions like Brave's; persistent caching of results in a local knowledge base could breach such terms.

### Gaps
- Ollama, LangSearch, Linkup, You.com privacy/training terms for search queries were not found/verified.
- Full ToS texts for Exa, Tavily, Serper, SerpApi not read this session for explicit AI-use or result-storage clauses.
