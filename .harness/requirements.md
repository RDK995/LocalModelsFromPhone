# Requirements

## Goal

An iOS app, run inside **Expo Go** on the owner's iPhone, that lists every model installed in
Ollama on the Mac Studio by its real name, loads and unloads them (one resident at a time), and
holds multi-turn, streamed chats with whichever model is loaded — reached over the owner's
Tailscale tailnet only.

It **replaces** the existing Phone Reasoning Surface PWA
(`/Users/ryankenny/Projects/phoneToLocalModel`). It talks to Ollama through a **new, small,
self-contained Mac-side server** built in this repository; the OpenWeight harness
(`/Users/ryankenny/Projects/OpenCodeOpenWeightHarness`) and OpenCode are not in the request path.

**Web search (FR18–FR25, added 2026-09-29):** per conversation, the owner can let the model search
the web and read pages. All searching and page reading run on the Mac, free, with no account, API
key or payment. The search capability is a separate loopback-only service so that OpenCode, which
will join the harness later as its coding agent, can share it.

**Readable answers and inline sources (FR26–FR28, added 2026-09-30):** after using M10 on the
phone, the owner asked for formatted answers, a small site logo beside each sourced fact that opens
the page, and the source list folded away at the bottom.

**Follow-ups after the logo work (FR29–FR30, added 2026-09-30):** after M10c1/M10c2 the owner
reported, from phone screenshots, misaligned and cramped tables in answers and a broad web question
answered from a single website. These are built next, before M10d.

**Numbered citations (FR31, added 2026-09-30):** the model could not copy URLs accurately enough to
earn logos, so pages it reads are numbered and the app turns its `[n]` citations into logo links.

**Answer layout fix (FR32, added 2026-09-30):** after M10d, with the always-on server restarted
onto the M10c4 code, the owner's phone showed a web answer (a bulleted news list) drawn squeezed to
about half the screen width, with its text running out of the bubble over "Sources (n)" and the
model name. It was squeezed from the first streamed word and stayed broken after reopening the chat.
A table answer three minutes later (22:35) rendered at full width with its row cards intact.

**No-answer web reply fix (FR33, added 2026-10-01):** the owner's phone (20:15, model
nemotron3:33b, web switch on) showed a reply with 7 web steps and 14 sources but no answer text —
only thinking ending "Let's try to read that page." The model said it would read a page but made no
tool call and wrote no answer; the server's tool loop (`server/src/generations/manager.ts`, `if
(!offered || roundCalls.length === 0) break;`) took that round as the final answer and ended the
reply "complete" and empty, contrary to FR19's "runs the tool loop to the model's final answer".

**Deep research (FR34–FR40, added 2026-10-01):** after the research in
`reports/Local LLM deep research techniques.md` (notes under `research_notes/Local LLM deep research
techniques/`), the owner asked for a slower, more thorough web mode started explicitly per message:
a server-driven research run of about 8 minutes on a fast mixture-of-experts model
(`qwen3.5:35b-a3b`) that always ends in a report with server-assigned citations. The research found
local models under-search when left to decide (Qwen3-32B made fewer than 2 search calls per question
on BrowseComp-Plus) and that Ollama's native tool-calling path is unreliable for these models, so
code owns the loop and the model makes only small schema-constrained decisions.

**Fast deep research (FR41–FR45, added 2026-10-02):** the first live phone run after M19 (heat-pump
question, server restarted on the m19 branch) ended with an empty bubble; a Mac rerun took 1:54 to
plan and ran out of research time inside its first note call, ending `failed` with a sentence
blaming the pages. `reports/Fast local deep research redesign.md` (notes under `research_notes/Fast
local deep research redesign/`) traced it to `think: true` with no output cap on every step and to
silent streams. The owner chose the report's ranks 0–6 (all within FR34–FR40's guarantees), with the
phone liveness fixes applied to every reply, built before M20. LearningCircuit
`local-deep-research` was considered as a replacement and not adopted (see Decisions).

**Dated, priced deep research reports (FR46, added 2026-10-03):** the owner's M19h phone run of the
heat-pump question (`.harness/evidence/M19h-AC1-owner-report.md`, screenshot alongside) gave annual
kWh for heat pump and boiler but no £ running cost, and ended "against current market rates for
early 2024". Cause found in `server/src/generations/research.ts`: no deep research step is given
today's date (ordinary web replies are, `server/src/web/tools.ts`), so the model fell back on its
training-era date; and nothing makes the plan look up current unit prices, while the write step may
use only the notes, so a £ figure appears only when a read page happens to state one (M19g's Mac run
of the same question did, `.harness/evidence/M19g-T7-heat-stream.txt`).

## Functional Requirements

- [FR1] **Model list.** The app lists every model installed in Ollama (`GET /api/tags`) by its
  real name, with its size. Models installed later appear without any app change; model names
  are never hardcoded.
- [FR2] **Resident state.** The app shows which model is currently resident in memory
  (`GET /api/ps`), truthfully — including a model loaded by another tool on the Mac — and shows
  an explicit "nothing loaded" state when none is.
- [FR3] **Load is a swap.** Loading model X first unloads every other resident model, then loads
  X. The UI shows loading → ready for X, or a specific failure (e.g. insufficient memory, model
  not found, Ollama unreachable). At most one model is resident as a result of a phone action.
- [FR4] **Stays loaded.** A model loaded from the phone stays resident indefinitely (Ollama
  `keep_alive` set so it is never idle-evicted) until the user unloads it or swaps it out. Chat
  requests sent by the server must preserve this, not reset it to Ollama's default idle timeout.
- [FR5] **Unload.** An explicit unload action evicts the resident model and frees its memory.
- [FR6] **Busy warning.** Before a swap or unload, the app warns and requires explicit
  confirmation when either (a) a reply from this app is still being generated, or (b) the resident
  model was not loaded by this server (so another tool on the Mac may be using it). Confirming
  proceeds and may interrupt the other user. Ollama exposes no "in use" signal, so (b) is the
  best available approximation and is labelled as such in the UI.
- [FR7] **Chats.** Multiple conversations, listed newest first, supporting create, open and
  delete. Transcripts are persisted on the phone and survive app restarts. Each prompt is sent
  with the conversation's prior turns so the model has context.
- [FR8] **Model attribution.** Each prompt is sent to the currently resident model. Each assistant
  reply records and displays the model name that produced it. Switching model mid-conversation is
  allowed and history carries over. If no model is resident, sending is blocked with a prompt to
  load one.
- [FR9] **Streaming and stop.** Replies render incrementally as tokens arrive. A Stop action
  cancels the generation on the Mac and stops output; the partial reply is kept and marked
  stopped.
- [FR10] **Thinking.** For models that emit reasoning/thinking output, it is shown as a collapsed,
  expandable section separate from the answer.
- [FR11] **Dropped-connection recovery.** A transport drop or app backgrounding mid-reply does not
  cancel the generation on the Mac. On reconnect / return to foreground the app resumes the reply
  from where it left off with no gaps and no duplicated text, and receives the terminal state.
  Only an explicit Stop cancels.
- [FR12] **New Mac-side server.** A new server in this repository mediates all phone traffic to
  Ollama (`127.0.0.1:11434`): model list, resident state, load, unload, chat generation, cancel
  and resume. It binds to loopback. The OpenWeight harness is not modified and not used.
- [FR13] **Password.** Every server endpoint requires a bearer token. A Mac-side command copies
  the token to the clipboard (for Universal Clipboard paste on the iPhone); the user pastes it once
  into an in-app settings screen and the app stores it in secure device storage. The Mac command
  refuses a token file that is group- or world-readable. A `401` shows a "password wrong or
  changed" message and routes to the settings screen. No QR code pairing.
- [FR14] **Tailnet only.** The server is reachable from the phone only via Tailscale (Serve over
  HTTPS on the tailnet). No Tailscale Funnel, no public exposure, no LAN-wide bind.
- [FR15] **Always on.** Per-user macOS LaunchAgents keep both the server and the process that
  serves the app bundle to Expo Go running, and restart them after a crash or reboot, so opening
  the project in Expo Go on the phone needs no manual step on the Mac. The bundle is reachable over
  the tailnet.
- [FR16] **Plain-language errors.** Distinct user-facing messages for: Mac/server unreachable,
  Ollama down, wrong password, model failed to load, model no longer installed, and a reply
  already in progress.
- [FR17] **Retire the PWA.** After this app's acceptance criteria pass, the PWA's LaunchAgent and
  its Tailscale Serve `/app` handler are removed, leaving the harness's own `/` handler intact. The
  `phoneToLocalModel` repository is left on disk untouched.
- [FR18] **Web search switch.** Each conversation has a web-search switch, off by default and
  persisted with the conversation. Only while it is on does the server offer the model the web
  tools (FR19); while off, the reply makes no search or page request of any kind. Changing the
  switch while a reply is in progress takes effect from the next prompt. The switch is disabled,
  with an explanation, when the resident model lacks Ollama's `tools` capability (`/api/show`).
- [FR19] **Model-driven search.** With the switch on, the server offers the model two tools via
  Ollama tool calling: `web_search(query)` and `read_page(url)`. The model decides when to call
  them; the server runs the tool loop to the model's final answer. At most 10 tool calls per
  reply; after the cap the tools are withdrawn and the model must answer. When the switch is on,
  the server tells the model the current date.
- [FR20] **Search on the Mac, no accounts.** `web_search` runs on the Mac with no account, key or
  payment: a multi-engine scraping library (`ddgs`) is primary; if it errors or returns zero
  results, a headless real browser on the Mac (started on demand, closed afterwards) performs the
  search. No hosted search or fetch API is used (not Ollama web search, Exa, Parallel, Tavily,
  Jina, Brave or similar). Results are requested for region UK / English (never "all languages").
  If both fail, the tool result tells the model search is unavailable, the model answers anyway,
  and the app shows that search was unavailable.
- [FR21] **Page reading on the Mac, safely.** `read_page` fetches the page on the Mac and returns
  its main content as markdown (boilerplate removed), truncated to a fixed size limit and marked
  as truncated when cut. Only `http`/`https`. It refuses any destination that resolves to
  loopback, private (RFC 1918), link-local, CGNAT/tailnet (`100.64.0.0/10`, including
  `100.100.100.100`), unspecified, multicast or the IPv6 equivalents (`::1`, `fc00::/7`,
  `fe80::/10`, IPv4-mapped forms); every redirect hop is re-checked, and the address checked is
  the one connected to (no DNS-rebinding gap). Byte and time limits apply; non-text content is
  refused. Page text is passed to the model as untrusted data.
- [FR22] **Steps and sources in the app.** While a reply is generated, the app shows each web
  step as it happens (e.g. "Searching: <query>", "Reading: <domain>", and a failed or unavailable
  step). When the answer is complete the steps collapse into an expandable section, like thinking
  (FR10). Each answer that used the web ends with a list of sources — the pages read, or, if none
  were read, the search results given to the model — each tappable to open in Safari.
- [FR23] **Persistence, stop and resume.** Web steps and sources are saved with the reply in the
  conversation. Full search results and page text are not persisted and are not re-sent with
  later prompts; later prompts carry the prior answers and their source lists (the model may
  re-read a page). FR9 and FR11 apply to web replies: a drop or backgrounding does not stop
  searching on the Mac, the app resumes with steps and text with no gaps or duplicates, and Stop
  cancels any in-flight search or page read. A reply that is searching counts as "a reply in
  progress" for FR6 and for sending.
- [FR24] **Time limits.** Each search and page read has a time limit; a step that exceeds it
  fails, the model is told it failed, and the reply continues.
- [FR25] **Separate local search service.** Search and page reading are provided by a separate
  Mac-side service bound to loopback only, with a documented HTTP API, kept running by a per-user
  LaunchAgent (as FR15). The phone never calls it directly; the FR12 server calls it. It has no
  token (loopback-only is the boundary) and is not exposed via Tailscale Serve. It is designed so
  OpenCode can later use it (e.g. via an MCP or custom-tool wrapper); integrating OpenCode is not
  part of this work.
- [FR26] **Formatted answers.** Every assistant answer — web or not, including replies already
  saved on the phone — renders its markdown (bold, italics, headings, ordered/unordered lists,
  inline code/code blocks, links) instead of showing the raw markup (`**`, `#`, `[text](url)`).
  Rendering works while the reply is still streaming (incomplete markup never breaks the view).
  The collapsed thinking section (FR10) stays plain text. A link in an answer is treated per FR27.
- [FR27] **Inline source logos.** Where an answer contains a markdown link whose URL matches one
  of that reply's saved sources (FR22/FR23), the link's text is shown as ordinary text followed by
  a small logo of that website; tapping the logo opens the page in Safari. Matching tolerates
  trivial differences (scheme http/https, a leading `www.`, a trailing slash). Any other link —
  a URL not in the reply's sources, a truncated/made-up URL such as `https://www.msn.com/...`, or
  any link in a reply that has no sources — is shown as plain, non-tappable text with no logo.
  The logo is the site's own icon, fetched **by the Mac** from that website (no third-party
  logo/favicon service) and passed to the phone; the phone never contacts a website or logo service
  itself — it asks the FR12 server (token-authenticated) for a site's logo. The Mac's icon fetch
  applies the FR21 rules (public addresses only, every redirect re-checked, the connected address
  checked, byte and time limits) and accepts image content only. Logos are cached on the Mac (a site
  is fetched once, not per request) and on the phone (not re-asked on every render). Logos are
  requested when an answer is shown, so replies saved before this change get logos too. When the
  site has no icon, refuses the Mac, or the Mac is unreachable, a generic globe icon is shown
  instead. A logo failing to load never blocks or breaks the answer.
- [FR28] **Collapsed source list.** The source list at the end of a web answer (FR22) is collapsed
  by default behind a header showing the count (e.g. "Sources (5)"); tapping it expands and
  collapses the list. The expanded state is not persisted (a reopened chat shows it collapsed).
  Each source is a separate entry — its own site logo (as FR27) and its page title — tappable to
  open in Safari; distinct sources are never merged into one link.
- [FR29] **Readable tables.** A markdown table in an assistant answer (web or not, new or already
  saved; FR26) renders with every body cell under its own column heading: a row with fewer cells
  than the header row is padded with empty cells, and a row with more has the surplus text kept
  (joined into the last column), never dropped or shifted. A table of two columns renders as a
  grid; a table of three or more columns renders as one card per body row, each card listing
  "heading: value" per column on its own line, so nothing is squeezed at phone width and no
  sideways scrolling is needed. Inline formatting and links in cells follow FR26/FR27. A table
  still streaming (header only, half a row) renders without error. The cause of the 2026-09-30
  misalignment (model output shape vs. the FR26 renderer) is diagnosed and covered by a test.
  A row missing a column separator (two values the model wrote into one cell) is padded, not
  re-split: it lines up with the header and loses no text, but a value may sit under the next
  heading with the last column empty; no dash/colon splitting heuristic (human decision, 2026-09-30).
- [FR30] **Several sites for broad questions.** With the web switch on, the instructions the
  server gives the model (alongside the FR19 date note) tell it that for a broad or open-ended
  question (e.g. "today's news trends") it should search with more than one query, not put the
  exact date into search queries, read pages from at least three different websites before
  answering, and cite the pages it relied on; a narrow factual question need not search more than
  it needs. The same instructions tell it to cite pages it read by their FR31 number (e.g. `[2]`),
  including source cells in tables, rather than by typing URLs. The diversity guidance is guidance
  only: the server does not check or re-prompt the model's choices, and the FR19 cap of 10 tool calls
  is unchanged.
- [FR31] **Numbered citations become logo links.** Within one web reply, each distinct page the
  model reads with `read_page` gets a number, in first-read order starting at 1 (a page read twice
  keeps its first number; distinct = the final URL after redirects, compared as FR27). The page
  text given to the model is labelled with that number, and search-result listings do not use
  bracketed numbers that could be mistaken for citations. Search results the model did not open
  get no number. The reply's saved sources (FR22/FR23) carry each read page's number, so a saved,
  reopened or resumed reply resolves numbers identically. In the answer, a citation mark `[n]`, a
  group such as `[1][3]` or `[1, 3]`, or the `【n】` form (the number alone, or followed by extra
  text inside the brackets) is shown as the logo of page n (FR27 logo rules and fallbacks), tapping
  it opens that page's exact saved URL in Safari; the mark itself is not shown. A number with no
  read page in that reply, a mark in a reply without numbered sources (including replies saved
  before this change), or a mark inside inline code or a code block is shown as the original plain
  text. While streaming, an incomplete mark (e.g. `[2`) shows as text until complete. Markdown links
  keep their FR27 behaviour. Each reply has its own numbering; numbers are never resolved against
  another reply's sources. Neither the server nor the app rewrites the model's text otherwise.
- [FR32] **Answers fit their bubble.** Every assistant answer (web or not, streaming, finished,
  or reopened from saved history, any FR26 content: paragraphs, bulleted/numbered lists, headings,
  FR29 table cards, FR27/FR31 inline logos) is laid out at the full width available to the answer
  bubble, and all of its text is inside the bubble: the FR28 "Sources (n)" header and the model
  name always sit below the answer text and never overlap it or any other text. The cause of the
  2026-09-30 22:32 squeezed/overflowing answer is diagnosed and covered by a test. No change to what
  the model is told, to the server, or to the FR29 card layout beyond keeping it inside the bubble.
- [FR33] **A web reply always ends with an answer.** Applies to web replies only (switch on); a
  reply with the switch off is unchanged. A model round "goes quiet" when it ends with no answer
  text (empty or whitespace-only content) and no tool call; thinking does not count as an answer.
  (a) When a round goes quiet while the tools are still offered (fewer than 10 tool calls used),
  the server prods the model to carry on — tools still offered, so it may search, read or answer —
  at most **2 prods per reply**. The prod is a server-side message (wording the server's choice: it
  says no answer has been given yet and to call a tool if more information is needed, otherwise to
  write the final answer now). (b) A quiet round after both prods are used gets one final round
  with the tools withdrawn and the model told to answer from what it already has — the same as the
  FR19 after-cap round. (c) If a round with the tools withdrawn (after the cap or after (b)) goes
  quiet, the reply's answer text is the note "No answer was produced — the model stopped without
  answering. Try asking again." and the reply ends `complete` with its steps and sources saved as
  usual (FR22/FR23). (d) Each prod appears as a web step "Asked the model to continue", and the
  tools-withdrawn round of (b) as "Asked the model to answer now"; these steps stream live, are
  saved with the reply, and show again when it is reopened or resumed. (e) Prod messages are part
  of that reply's tool loop only: they are not saved in the conversation and not sent with later
  prompts. (f) FR9/FR11/FR23 stop and resume, FR24 time limits, and the FR19 10-call cap are
  unchanged; prods do not count as tool calls. A round with answer text is the final answer as
  before.
- [FR34] **Deep research is started by the owner, per message, on the fast model only.** When a
  conversation's web switch (FR18) is on, the composer offers a "Deep research" action beside Send;
  using it sends that one message as a deep research run (FR35). Later messages are ordinary replies
  unless the action is used again. With the web switch off the action is not shown (FR18's "no web
  traffic while off" stands). The action is enabled only while the resident model is the configured
  deep-research model; otherwise it is shown disabled with the line "Load <model name> to use deep
  research". The deep-research model name is a Mac-side server setting (default
  `qwen3.5:35b-a3b`), reported to the app by the server — the app hardcodes no model name (FR1). The
  app never swaps models for a run; the owner loads the model as today (FR3). The model never starts
  a deep research run by itself (no `deep_research` tool is offered to the chat model).
- [FR35] **A server-driven research loop.** A run is a fixed sequence owned by server code, not a
  model tool loop: (1) brief — restate the question as a short research brief; (2) plan — split it
  into sub-questions (the count is set by the server, not the model); (3) for each sub-question,
  search with more than one query (a server-set minimum number of searches; exact repeats after
  normalising are skipped), choose pages from the URLs the server parsed out of the results, read
  them (FR21 `read_page` rules apply unchanged), and record short notes each carrying a verbatim quote
  and the page's number (FR37); (4) gap check — decide whether to search further; the model judging
  it has enough may end a sub-question early but is never the only stopping rule; (5) write one
  report from the notes in a single final call. Each model step is a narrow request whose reply is
  constrained to a JSON schema (Ollama `format`), validated, and retried a bounded number of times;
  a step that still fails is skipped and the run continues. The model reads only the answer content,
  never its thinking. Each request carries only the stable instructions, the brief, the plan, the
  capped rolling notes and the latest result — never a growing transcript of raw pages; raw page text
  is discarded once noted. Every request sets `num_ctx` explicitly and keeps the model resident
  (FR4). Page text is untrusted data: it can only influence notes and the choice among
  server-parsed URLs, and can trigger nothing but search and read.
- [FR36] **About 8 minutes, and it always ends with a report.** A run has one overall time budget
  (about 8 minutes, a server setting), with roughly a quarter reserved for writing the report. The
  deadline is checked before every search, read and model call; each search and read keeps its own
  FR24 time limit; one cancellation signal reaches every in-flight search, read and model request.
  When research time runs out the run moves to writing with what it has. The run always ends with a
  reply whose status is shown on it: `complete` (finished normally), `partial` (stopped early by the
  deadline or by Stop, FR38, or with gaps), or `failed` (no usable material — e.g. every search
  backend unavailable — in which case the answer is a plain sentence saying the research could not
  search, plus any steps). A run never hangs and never ends with an error and no reply (extends FR33
  and M13). The phone shows each phase live as web steps (FR22), e.g. "Planning", "Searching:
  <query>", "Reading: <domain>", "Writing report", plus elapsed time against the budget (e.g. "3:12
  of 8:00").
- [FR37] **Citations by construction.** Each distinct page read in a run gets a number in first-read
  order (FR31 numbering, distinctness and saved-source rules). The report may cite only `[n]`; the
  server removes from the report any citation number that is not a page read in this run before it
  is saved or streamed as final, and the model never types a URL into the report. Each note's quote
  is checked by substring match (after whitespace normalisation) against that page's stored text;
  a note whose quote does not match is dropped before writing. The app renders the report's `[n]`
  marks as logos exactly as FR31 and the Sources list (FR22/FR28) is the pages read.
- [FR38] **Stop, resume and saving.** FR9, FR11 and FR23 apply to a run: a dropped connection or
  backgrounding does not stop it on the Mac, and the app resumes with steps, clock and text with no
  gaps or duplicates. A first Stop cancels in-flight searching and reading at once and moves the run
  to writing a short report from the notes so far (about a minute, its own short time limit), saved
  `partial`; a second Stop during that write-up cancels it and the reply ends stopped with its steps
  and sources but no report. The report is saved as the reply's answer, with steps, sources and
  status; page text and notes are not persisted and later prompts carry the report like any prior
  answer (FR23). A running deep research reply counts as a reply in progress (FR6, sending refused).
- [FR39] **Search backends rest after being blocked, and repeat requests are cached.** The search
  service (FR25) treats each search backend as a circuit breaker: a backend that returns a
  rate-limit / too-many-requests response is skipped for 1 hour, one that returns a CAPTCHA or
  bot-check for 24 hours, and searches go to the remaining backends (then FR20's headless browser) in
  the meantime. Search results are cached by normalised query and page reads by final URL for 24
  hours on the Mac. This applies to ordinary web replies (FR19) as well as deep research, and keeps
  FR20's region and no-account rules. If every backend is resting or failing, the search is
  "unavailable" as in FR20.
- [FR40] **No change to ordinary replies.** Ordinary web replies (FR19, FR30, FR31, FR33) and
  replies with the switch off behave as before, apart from FR39's resting and caching and FR45's
  stream keep-alive, per-outage resume allowance and error line (amended 2026-10-02).
- [FR41] **Every deep research model call is measured, and the model is not reloaded at the start.**
  The server writes one structured log line per deep-research model call with: step name, the `think`
  value sent, attempt number, wall time, and Ollama's `load_duration`, `prompt_eval_count`,
  `prompt_eval_duration`, `eval_count`, `eval_duration`, plus the character count of
  `message.thinking`. When the deep-research model is warmed/loaded by the server it is sent the same
  `num_ctx` the research calls use, so the first research call does not rebuild the runner. No global
  Ollama context setting (e.g. `OLLAMA_CONTEXT_LENGTH`) is changed; ordinary replies' context is
  untouched.
- [FR42] **Thinking only where it pays; every model call is time-capped.** Brief, query proposal,
  page choice, note-taking and gap check are sent with top-level `think: false` on `/api/chat`, an
  output cap (`num_predict`; default about 200 tokens, about 800 for notes — server settings) and
  non-thinking sampling (model-card defaults: temperature 0.7, top_p 0.8, top_k 20; schema steps may
  use a lower temperature if it validates better). Each such call has a hard wall-clock cap (default
  about 30 s, server setting); a call that hits it is cancelled and counts as a failed attempt under
  FR35's retry-then-skip rule. Plan and write keep thinking on, streamed, under a thinking time guard
  (default about 30 s for plan, about 60 s for write — server settings, write's guard fitting inside
  the FR36 write reserve); if thinking exceeds the guard the request is cancelled and re-issued once
  with `think: false`, never truncating an answer. Output caps are never applied to a thinking-on
  request. FR35's `format` and `num_ctx` rules are unchanged.
- [FR43] **Note calls get passages, not pages.** The stored page text is split on headings and
  paragraphs into passages (about 150–400 words) and ranked by keyword relevance (BM25 or
  equivalent, in-process, no extra model) against the sub-question and the main question's terms.
  The note call receives the page title, its first paragraph and the top passages, about 2–3K tokens
  in all (server setting), with page text first and the task last. A page with no passage above the
  relevance threshold, with almost no extracted text, or showing bot-challenge markers is skipped
  without a model call and logged as "empty" or "blocked". Quotes are still checked against the full
  stored page text (FR37) and raw text is still discarded once noted (FR35). Fixed instructions form
  a byte-stable prompt prefix: per-step task text goes at the end of the user message, not in the
  system message.
- [FR44] **Breadth first, pages fetched ahead, partial notes kept.** Every sub-question gets its
  searches and its first page before any sub-question gets a second page. Chosen pages are fetched in
  parallel as soon as page choice returns (each keeping its FR24 limit and FR36 cancellation), while
  model calls stay strictly one at a time. A sub-question ends early when a search round adds no new
  URLs. When the deadline cuts a note call, every complete note already present in its partial output
  is kept (still quote-checked). A run that ends with no notes because research time ran out says so
  in its failure sentence ("The research ran out of time before it could take notes.") instead of
  claiming the pages were unusable; its status stays `failed`.
- [FR45] **The phone always shows that a reply is alive.** For deep research, the server emits a
  "started" step before awaiting every search, read and model call (not only after it returns), with
  model-call steps such as "Choosing pages", "Taking notes: <domain>" and "Checking for gaps"; the
  app's elapsed clock ticks every second locally from the last server `elapsed_ms`, capped at the
  budget, re-anchored on every event and after every resume. For **all replies** (deep research,
  ordinary web, switch off): the server sends an SSE comment keep-alive at least every 15 s while a
  stream is open (comments carry no event ID, so FR9/FR38 resume and no-gaps/no-duplicates are
  unchanged); the app's 300 s resume allowance applies per outage (reset after every successful
  resume) rather than to the whole reply; and a reply saved with error status and no answer text
  shows a plain line (e.g. "Lost connection to the Mac before the reply arrived") with its steps
  visible, never an empty bubble.
- [FR46] **Deep research reports know today's date and turn usage into money.** (a) Every deep
  research model step (brief, plan, queries, pages, notes, gap, write) is given today's date from the
  Mac clock (weekday, date and ISO date, as in `server/src/web/tools.ts`), in the user message, not
  the system message, so FR43's byte-stable prefix holds. (b) The write step is told never to call
  a price or period "current", "today's" or name a period such as "early 2024" unless a cited note
  gives that period; a quoted price carries the date or period its page gives (e.g. "the
  October–December 2026 price cap [3]"), or no date claim if the page gives none. (c) When the
  question asks about costs, prices, bills or running costs, the plan step is told it must include a
  sub-question for current unit prices relevant to the question (e.g. electricity and gas per kWh in
  the user's country); this is an instruction to the model, not a server-side classifier. (d) The
  write step is told that where notes give a quantity (e.g. kWh a year) and a unit price, the report
  states the money figure in the question's currency with the sum shown (e.g. "2,700 kWh × 26p ≈ £700
  a year [2][4]"), citing the pages for both numbers; and that when the question asks about cost but
  no note gives a price, the report says plainly that no current price was found rather than
  silently omitting cost. FR37 citation rules are unchanged; the arithmetic is the model's and is
  not checked by the server. Ordinary web replies are unchanged (FR40).

## Acceptance Criteria

All proven against the live Mac Studio and Ollama, not mocks.

1. **AC1** — The app's model list equals the set of names reported by Ollama `GET /api/tags`
   (currently five models).
2. **AC2** — Load A then load B: `GET /api/ps` shows only B. Unload: `GET /api/ps` is empty.
3. **AC3** — A model loaded from the phone is still resident in `GET /api/ps` after 10 minutes
   idle, and still after a chat reply completes.
4. **AC4** — A reply renders incrementally; a follow-up in the same conversation demonstrably uses
   context from the earlier turn; each reply shows the model that produced it.
5. **AC5** — Stop ends generation on the Mac and output stops.
6. **AC6** — Killing the connection mid-reply and reconnecting yields the complete reply with no
   gaps and no duplicated text.
7. **AC7** — Swap/unload during an in-flight reply, and swap/unload of a model the server did not
   load, each require confirmation; cancelling the confirmation changes nothing.
8. **AC8** — Conversations survive force-quitting and reopening Expo Go.
9. **AC9** — Every server endpoint returns `401` without the correct token; the app routes a `401`
   to the password screen. The Mac command refuses a group/world-readable token file.
10. **AC10** — Neither the server nor the bundle is reachable from outside the tailnet.
11. **AC11** — After a Mac reboot, opening the project in Expo Go on the iPhone works with no
    manual step on the Mac.
12. **AC12** — After retirement, `/app` no longer resolves, the PWA LaunchAgent is gone, and the
    harness `/` handler still works.
13. **AC13** — With the switch off, a chat reply sends no `tools` to Ollama and the search service
    receives no request; the switch state survives force-quitting Expo Go. With a resident model
    lacking the `tools` capability the switch is disabled (proven with a stubbed capability check
    if no installed model lacks it).
14. **AC14** — With the switch on, a prompt that asks for current information (e.g. today's news)
    produces at least one search step shown live on the phone, a final answer, a source list whose
    links open in Safari, and the steps collapse after completion. The model is given the current
    date.
15. **AC15** — `read_page` on a real article returns its main text as markdown; oversized pages
    come back truncated and marked. It refuses `http://127.0.0.1:7789`, `http://localhost`, a
    `100.x` tailnet address, a `192.168.x.x` address, `http://[::1]`, a non-http scheme, and a
    public URL that redirects to any of these.
16. **AC16** — With `ddgs` forced to fail or return nothing, the headless browser returns results;
    with both forced to fail, the reply still completes and the app shows search was unavailable.
    A step exceeding its time limit fails without hanging the reply.
17. **AC17** — Killing the connection during a web reply and reconnecting yields the complete steps
    and answer with no gaps or duplicates; Stop during a search ends it on the Mac. A reply is
    capped at 10 tool calls.
18. **AC18** — No hosted search/fetch API or key is configured or called (code/config inspection
    plus an outbound check during AC14). Persisted conversations contain steps and sources but not
    page text, and a follow-up prompt does not re-send page text.
19. **AC19** — The search service answers on loopback, is not reachable from the tailnet or LAN,
    restarts automatically after being killed, and its HTTP API is documented.
20. **AC20** — An assistant answer containing bold, a heading, a list, inline code and a link renders
    with no raw markdown characters visible, both for a newly streamed reply and for a reply saved
    before this change; a reply mid-stream with unterminated markup renders without error.
21. **AC21** — In a web answer, a link whose URL matches a saved source (including a `www.`/
    trailing-slash/scheme variant) shows the site's logo after its text and tapping it opens that
    page in Safari; a link not among the sources (e.g. `https://www.msn.com/...`) and a link in a
    non-web answer are plain, non-tappable text with no logo; a site with no reachable logo shows
    the globe icon. No third-party logo service is called, and the phone contacts no website or
    logo service directly — logos arrive from the Mac (checked by inspection plus a network
    observation during the live proof).
22. **AC22** — A web answer's sources start collapsed as "Sources (n)", expand and collapse on tap,
    and each source is its own tappable entry (logo + title) opening in Safari — including a source
    set shaped like the 2026-09-30 phone screenshot in which several sources rendered glued into one
    link. Proven by unit tests, a Mac-side live proof, and the owner's phone screenshot.
23. **AC23** — Unit tests: a table shaped like the 2026-09-30 phone screenshot (trend, description,
    source columns) renders each value under its own heading when each value has its own cell (a
    row missing a separator is padded, not re-split, and loses no text); a row with missing cells and a row
    with extra cells lose no text and shift nothing; a 2-column table renders as a grid and a
    3+-column table as one card per row with "heading: value" lines; a half-streamed table renders
    without error; a saved reply's table renders the same way. Plus the owner's phone observation.
24. **AC24** — Live on the Mac with the owner's usual tools-capable model resident (named in the
    evidence) and the web switch on: of 3 broad prompts (including "What are today's news
    trends"), at least 2 produce replies whose saved sources span at least 3 distinct websites
    (host compared ignoring a leading `www.`). In the same run, at least 2 of the 3 replies each
    cite at least 3 distinct saved sources in a form that shows a logo (an FR31 number mark that
    resolves, or an FR27-matching link), and none of their citation marks or links fails to resolve
    to a saved source. The server's web instructions contain the FR30 guidance, including the
    cite-by-number wording (unit test).
25. **AC25** — Unit tests: read pages get first-read numbers (a re-read page keeps its number, a
    redirect resolves to the final URL), the page text given to the model carries its number, search
    listings carry no bracketed numbers, and the saved sources carry the numbers. The app shows `[n]`,
    `[1][3]`, `[1, 3]` and `【n】` marks as page n's logo opening its exact saved URL; an unknown
    number, a mark in an old reply without numbered sources, and a mark inside code stay plain text;
    a half-streamed `[2` renders without error; a reopened saved reply resolves the same logos as the
    live one.

26. **AC26** — A test reproduces an answer shaped like the 2026-09-30 22:32 phone screenshot
    (`.harness/evidence/FR32-owner-phone-squeezed-2026-09-30-2232.png`: a web reply whose body is a
    bulleted list of news items, with a Sources list) and shows, for the live-streaming and the
    reopened-saved forms, that the answer takes the full bubble width and nothing overlaps the
    answer text; existing FR26-FR31 rendering tests pass unchanged. Plus the owner's phone
    screenshot of a new web answer (after the phone has loaded the new code) showing the answer
    full width, entirely inside its bubble, with "Sources (n)" and the model name below it.
27. **AC27** — Server tests with a scripted fake Ollama (a real model cannot be made to go quiet on
    demand; agreed with the owner 2026-10-01) prove FR33: a round shaped like the 2026-10-01 20:15
    screenshot (`.harness/evidence/FR33-owner-phone-no-answer-2026-10-01-2015.png`: thinking only,
    no content, no tool call, tools offered) is followed by a prod with tools still offered; quiet
    once then answer, quiet once then a tool call then answer, and quiet twice then answer each end
    with that answer; quiet three times gives an "Asked the model to answer now" round with no tools
    offered; a quiet tools-withdrawn round (after (b), and after the 10-call cap) ends `complete`
    with the FR33 note as the answer text plus steps and sources; whitespace-only content counts as
    quiet; prods are not counted toward the 10-call cap; a switch-off empty reply is unchanged; prod
    messages do not appear in the saved conversation or in the next prompt's messages; Stop during a
    prodded round cancels as before. App tests show the two new step lines live and in a reopened
    saved reply. Live on the Mac: an ordinary web reply with the owner's usual model still completes
    with steps, sources and an answer, and the existing M13 web-failure proof still passes. Plus the
    owner retrying the transfer question from the screenshot on the phone (observation, not a gate).
28. **AC28** — Automated tests with a scripted fake Ollama and fake search/page backends prove
    FR34–FR39: the action is hidden with the switch off, disabled with the "Load <model> …" line when
    another model is resident, and enabled for the configured model, whose name comes from the
    server; a run follows brief → plan → search/read/note → gap check → write and its steps stream
    live and are saved; every model request carries `format` and `num_ctx` and no raw page beyond the
    current one; a malformed JSON step is retried then skipped without ending the run; a run ends
    within budget (plus a small margin) with all backends failing (`failed`, plain sentence), with a
    slow backend, and with the deadline hitting during the write-up; a report citing a number with no
    read page has it removed; a note with a non-matching quote is dropped; first Stop yields a
    `partial` short report, a second Stop yields steps and sources with no report; a dropped
    connection resumes with no gaps or duplicates; a backend returning rate-limit is skipped for 1
    hour and one returning a CAPTCHA for 24 hours; a repeated query and page are served from cache;
    ordinary web replies' existing tests pass unchanged.
29. **AC29** — Live on the Mac with `qwen3.5:35b-a3b` resident (downloaded for this work): 3 real
    research-style questions, plus the 2026-10-02 heat-pump question (amended 2026-10-02), each end within the budget plus a small margin with status `complete`
    or `partial`, a report citing at least 3 distinct read pages, and no citation number that fails
    to resolve to a saved source. The owner's opinion of report quality is recorded in the evidence
    but is not a gate.
30. **AC30** — The owner's phone screenshot of a finished deep research reply showing its steps, its
    status, logo citations and "Sources (n)".
31. **AC31** — Automated tests with a scripted fake Ollama and fake search/page backends prove
    FR41–FR45: one log line per model call with the FR41 fields; the warm-up sends the research
    `num_ctx`; each step sends the specified `think` value, and `num_predict` only on thinking-off
    steps; a thinking-off step whose fake reply contains thinking text is detected (not trusted from
    the setting); a routine call exceeding its cap is cancelled and retried/skipped; a plan or write
    whose thinking exceeds its guard is re-issued with `think: false`; the note request carries a
    page excerpt within the size cap and a quote outside the excerpt but in the full page still
    matches; empty, blocked and no-match pages make no note call; sub-questions are served breadth
    first; reads start in parallel while model calls never overlap; a deadline-cut note call keeps
    its complete notes; a time-out run with no notes uses the "ran out of time" sentence; "started"
    steps precede each await; keep-alives arrive at least every 15 s on deep, ordinary web and
    switch-off streams without disturbing resume; the resume allowance resets after a successful
    resume; an error reply with no text shows the error line with steps, on deep and ordinary
    replies. All existing tests pass.
32. **AC32** — Live on the Mac: the FR35 `format` probe is re-run with thinking off on the installed
    Ollama and its validity rate recorded; the AC29 question set is run with FR41 logging, and per
    run the total wall time, research-phase model calls, distinct pages read, notes kept, planning
    time and routine-call p50/p95 are recorded in evidence. Pass/fail is AC29's (time, status, ≥ 3
    cited pages, resolvable citations); the speed figures are recorded, not gated (targets for
    reference: routine p50 < 10 s, planning < 40 s).
33. **AC33** — On the owner's phone: during a deep research run, airplane mode is turned on for about
    30 s twice; the reply still ends showing its steps and either the report or a visible status line
    (never an empty bubble), and the elapsed clock visibly advances every second throughout.
34. **AC34** — Automated tests with a scripted fake Ollama prove FR46: every deep research model
    request (brief, plan, queries, pages, notes, gap, write) carries today's date (from an injected
    clock) in its user message and the system message is byte-identical across steps and days; the
    plan request carries the current-prices instruction; the write request carries the no-undated-
    "current" rule, the show-the-sum rule and the say-no-price-found rule. All existing tests pass.
35. **AC35** — Live on the Mac with `qwen3.5:35b-a3b` resident and com.harness.server running this
    code: the 2026-10-02 heat-pump question is run 3 times and one further cost question ("What does
    it cost to run an electric car compared with a petrol car in the UK in 2026? Cover charging and
    fuel costs per year for typical mileage.") once. Pass if (1) at least 3 of the 4 reports give a £
    running-cost figure with a citation — either stated by a cited page or worked from cited usage
    and a cited unit price; (2) none of the 4 names a past period (e.g. "early 2024") as current
    prices unless a note it cites gives that period; and (3) each run meets AC29's bar (within budget
    plus a small margin, `complete` or `partial`, ≥ 3 distinct cited read pages, every citation
    resolves). Reports are saved as evidence; the owner's opinion of quality is recorded, not gated.

## Constraints

- Runs in **Expo Go** only: current Expo SDK, no custom native modules, no development build.
  Libraries must be Expo Go–compatible (e.g. secure storage and streaming fetch as provided by
  Expo).
- Mac-side code targets **Bun**, matching the neighbouring projects.
- Ollama at `127.0.0.1:11434` is the only model runtime. It exposes no per-model "in use" signal.
- Mac Studio has ~64 GB RAM; installed models are ~14–28 GB each. It is an **M1 Max** (32-core
  GPU, 64 GB; checked 2026-10-01); by default macOS lets the GPU use about 48 GB. Deep research run
  times in the research report were estimated for an M4 Max; expect roughly 1.5× on this Mac
  (estimate, not measured).
- Deep research (FR35) must set `num_ctx` on every Ollama request (Ollama silently truncates at its
  default) and must not change it between calls in a run; the FR21 truncation-only assumption in
  the "large context window" constraint below does not apply to it.
- `qwen3.5:35b-a3b` (about 24 GB) is available from the Ollama library (checked 2026-10-01, Ollama
  0.32.14 installed). Whether Ollama's `format` constraint holds while thinking is on is unverified
  and must be checked before relying on it.
- Tailscale Serve currently maps `/` → harness `127.0.0.1:7787` and `/app` → PWA
  `127.0.0.1:7788`. The new service must not disturb the harness mapping.
- Reuse is encouraged from `phoneToLocalModel`: SSE/stream parsing and resume logic, conversation
  store, error-message mapping, LaunchAgent and Tailscale Serve installers. From the harness:
  the token-file permission refusal. Copied code lives in this repository; neither source repo is
  modified.
- Web search: free and no sign-up only — no payment, no card, no account, no API key. Search
  queries reach public search engines directly (as a browser would), tied to no account.
- The headless browser (e.g. Playwright + Chromium) is a one-time download of a few hundred MB
  and runs only on demand. Python 3.14 is the available Python; `ddgs` compatibility with it is
  unverified (research, 2026-09-29).
- Scraping from one home IP is sometimes blocked by engines; results are best-effort.
- Loaded models run with a large context window (e.g. `nemotron3:33b` at 131 072 tokens, checked
  2026-09-29), so a reply's web material fits without special handling beyond FR21 truncation.
- Markdown rendering must be pure JavaScript and Expo Go–compatible (no native module).
- **The phone talks only to the Mac** (over the tailnet). The app makes no request to any website
  or third-party service; opening a page in Safari on the owner's tap is not the app's traffic.
- Broad-question source diversity and citing by number are best-effort model guidance (FR30); a
  single reply that uses fewer than three sites, or leaves a fact uncited, is not a defect. Turning a
  valid number into a logo (FR31) is deterministic and is not best-effort.

## Non-Goals

- App Store, TestFlight, or standalone (development/production) builds; own home-screen icon.
- Android.
- Any change to the OpenWeight harness.
- Chatting through OpenCode, or sending OpenCode coding jobs from the phone.
- Downloading, deleting or configuring models.
- More than one model resident at once from phone actions.
- Tier/profile labels.
- Images, voice, and any tool use other than web search and page reading (FR18–FR25).
- Hosted or paid search/fetch APIs, including free tiers that need sign-up.
- Integrating OpenCode with the search service (future work; FR25 only keeps it possible).
- Syncing conversations across devices.
- QR-code pairing.
- For deep research (FR34–FR39), deferred: the model starting a run by itself; light / normal /
  thorough presets; a replayable 20-question evaluation set; a reranker or any second resident
  model; PDF reading; a per-sentence entailment check; a headless-browser re-fetch for
  JavaScript-rendered pages.
- For fast deep research (FR41–FR45), deferred (each would need an amendment): search-snippet notes
  when a page cannot be read; merging brief and plan into one call; choosing pages in code instead of
  a model step; markdown-aware quote matching; fewer than two searches per sub-question; the Ollama
  MLX model tag (`qwen3.5:35b-a3b-nvfp4`, `format` ignored on MLX in Ollama 0.32); a global
  `OLLAMA_CONTEXT_LENGTH`; changing the page extractor; running models in parallel
  (`OLLAMA_NUM_PARALLEL` > 1). Replacing the loop with LearningCircuit `local-deep-research`.
- For dated, priced reports (FR46): a server check that a cost question's report contains a money
  figure, with an extra price search and rewrite when it does not (offered, declined 2026-10-03);
  server verification of the model's arithmetic; any change to ordinary web replies' prompts; a
  phone check (Mac runs only).

## Edge Cases

- Sending while a reply is already in progress: refused with a message.
- Another tool loads a different model behind the phone's back: the app shows the true resident
  model on its next refresh.
- The Mac reboots mid-conversation: the transcript is intact on the phone and the conversation
  continues once the Mac is back (full history is re-sent with each prompt).
- A model referenced in old replies is removed from the Mac: it disappears from the model list;
  old replies keep their model label.
- A load fails (e.g. out of memory): previous model is already unloaded; the app shows nothing
  loaded plus the failure reason.
- Token changed on the Mac: `401` → password screen.
- Search engines block the Mac: `ddgs` returns nothing → headless browser; both fail → "search
  unavailable", the model answers anyway.
- A page contains instructions aimed at the model (prompt injection): the tools are read-only, so
  the worst case is a misleading answer; the source list lets the owner check.
- The model asks to read a local, LAN or tailnet address, or a public URL redirects there:
  refused (FR21).
- The model keeps calling tools: capped at 10 calls per reply.
- The switch is changed mid-reply: applies from the next prompt.
- Swap/unload during a searching reply: FR6 confirmation.
- A follow-up asks about a page read earlier: the model re-reads it (page text is not kept).
- The model writes a link that is not one of the reply's sources, or a truncated URL: plain,
  non-tappable text, no logo (FR27).
- A site has no icon, blocks the Mac's request, or the Mac is unreachable: globe icon; the answer
  is unaffected (FR27).
- The Mac is asked for a logo of a site at a local, LAN or tailnet address, or the icon redirects
  there: refused (FR21 rules), globe icon (FR27).
- A reply is still streaming with half-written markup (e.g. an open `**` or `[text](`): shown
  without error and re-rendered as more text arrives (FR26).
- Two sources share a site: each is its own entry with the same logo (FR28).
- A table row with the wrong number of cells: padded or surplus kept, never shifted; a row missing a
  separator is padded, not re-split, so a value may sit under the next heading (FR29).
- A narrow web question need not read three sites (FR30).
- The model still cites a source in plain words or with a shortened URL despite the guidance: shown
  as plain text with no logo (FR27); nothing repairs it (FR30).
- The model cites a number that no read page has (e.g. `[40]`), or cites in a reply where it read no
  page: the mark stays plain text (FR31).
- A page's own text contains footnotes like `[1]` that the model copies: resolved against this
  reply's numbering like any other mark; a wrong-but-valid number shows the wrong page's logo, which
  is accepted (FR31).
- A reply answered only from search headlines (no page read): no numbered citations and no inline
  logos; its Sources list still shows the search results (FR22, FR31).
- A web answer whose text is a bulleted list, streaming or reopened: full bubble width, all text
  inside the bubble, Sources header and model name below it (FR32).
- Deep research pressed with another model resident: disabled, "Load <model> to use deep research"
  (FR34). The owner unloads the deep-research model mid-run: FR6 confirmation; if confirmed, the run
  ends `partial` or stopped like a Stop with no model (no hang).
- Every search backend is resting or blocked during a run: `failed`, plain sentence (FR36, FR39).
- The model's JSON step is malformed or empty: retried a bounded number of times, then skipped
  (FR35); a write-up that fails entirely ends `partial`/`failed` with the FR33-style note, never empty.
- The report cites a number with no read page, or types a URL: number removed; the server, not the
  model, supplies addresses (FR37).
- A page's text tells the model to do something: it can affect notes and page choice only (FR35).
- The phone is locked for the whole run: the run finishes on the Mac and the reply is there on return
  (FR38).
- A deep research run is in progress and the owner sends a message: refused as a reply in progress.
- A thinking-off step comes back with thinking text anyway (setting ignored): detected from
  `message.thinking`, logged, and treated as that step's result only if its content validates (FR42).
- A plan or write call thinks past its guard: cancelled and re-issued once with thinking off; if
  that also fails, FR35/FR36 skip and write-up rules apply (FR42).
- A page whose passages all score zero, a near-empty page, or a bot-challenge page: no note call,
  logged as "empty"/"blocked"; FR37's numbering and Sources rules for pages read are unchanged by
  the skip — the page simply yields no notes.
- Stop or the deadline while several prefetched reads are in flight: all are cancelled by the one
  signal (FR36, FR44).
- The connection drops several times in one long reply: each outage gets its own 300 s allowance;
  a single outage longer than that ends the reply on the phone with the error line and steps, while
  the Mac keeps running it (FR38, FR45); reopening later shows the saved reply.

## Decisions / Clarifications

- **Replace, not coexist** (human): the Expo app replaces the `phoneToLocalModel` PWA.
- **Every installed model, by real name** (human): reverses the PWA/harness "tier labels only,
  no physical model names" rule for this app.
- **One model resident at a time; load is a swap** (human).
- **Full multi-turn chats with history saved on the phone** (human).
- **New small server talking straight to Ollama** (human), chosen over extending the harness and
  over routing chats through OpenCode. OpenCode was investigated: it cannot load/unload models,
  wraps prompts in a coding-agent system prompt with file-editing tools, and exists here only as
  the harness's pinned 1.18.21 copy whose config points at a proxy on :11435 that is not running.
- **Loaded models stay resident until unloaded** (human).
- **Warn, then let the user choose** on swap/unload when busy or not loaded by this server
  (human).
- **Password pasted once via clipboard, no QR code** (human).
- Stop keeps the partial reply (default chosen by Claude, not asked).
- Thinking shown collapsed (default chosen by Claude, not asked).
- **Web search added** (human, 2026-09-29): reverses the "no tool use" non-goal for web search
  and page reading only.
- **Pay nothing, sign up for nothing** (human): after research
  (`.harness/research/Free web search for local models.md`, 2026-09-29) the human chose Mac-only search
  with no accounts; hosted free tiers (Ollama, Exa, Tavily, etc.) rejected.
- **Backup is a headless real browser** (human), chosen over Exa's keyless endpoint and over
  Wikipedia/small-web indexes.
- **Per-chat switch, off by default; the model decides when to search** (human).
- **The model may read whole pages** (human).
- **OpenCode will join the harness later** (human), so the search service is separate and
  shareable (FR25). This updates the earlier "OpenCode not in the request path" for future work
  only; this app's chats still do not go through OpenCode.
- Defaults chosen by Claude, shown to the human and agreed (2026-09-29): current date given to
  the model; page text not persisted or re-sent; UK/English results; a switch change applies from
  the next prompt; browser started on demand; search service auto-starts, loopback-only, no
  token; searching counts as a reply in progress; per-step time limits; 10 tool calls per reply;
  sources = pages read, else search results.
- **Formatted answers everywhere** (human, 2026-09-30): markdown renders in all answers, not only
  web ones, including already-saved replies.
- **Website's own logo, not a globe icon** (human, 2026-09-30), fetched by the phone directly from
  the site; a third-party logo service (e.g. Google) was rejected. Globe is the fallback only.
- **Logo only for real sources** (human, 2026-09-30): links not matching the reply's saved sources
  are plain non-tappable text.
- **Build before M11** (human, 2026-09-30): FR26–FR28 are the next milestone, ahead of M11.
- Defaults chosen by Claude, shown to the human and agreed (2026-09-30): thinking stays plain
  text; URL matching ignores scheme, `www.` and trailing slash; logos cached on the phone; the
  source list's expanded state is not persisted.
- **The phone talks only to the Mac; the Mac fetches logos** (human, 2026-09-30, later the same
  day): supersedes "fetched by the phone directly from the site" above. Chosen over dropping real
  logos for a globe on every source. Mac-side defaults chosen by Claude and agreed: FR21 safety
  rules apply to icon fetches, image content only, logos cached on the Mac and on the phone, logos
  requested at display time so older saved replies get them. Architecture deviation D-M10c-1
  (phone -> public web) is therefore no longer wanted and must be withdrawn/replaced when the
  architecture and M10c plan are updated.
- Owner phone observation of M10 (2026-09-30, screenshots shown in session): the web switch
  shown on, a web answer ending in a source list, and a source link opening the WSJ archive page
  in Safari. The same screenshots showed raw markdown and one source entry with several sources
  merged into a single link, which FR26–FR28 address.
- **Follow-ups next** (human, 2026-09-30): the owner-reported table and single-site follow-ups
  (recorded under M10c1 in milestones.md) become FR29–FR30, built after M10c2 and before M10d.
- **Wide tables become cards** (human): three or more columns render as one card per row
  ("heading: value" lines); two columns stay a grid. Chosen over sideways scrolling and over only
  fixing alignment.
- **Source diversity by guidance only** (human): clearer instructions to the model; chosen over
  the server checking for a single site and re-prompting (slower, uses the 10-call budget).
- **Pass bar: 3+ sites in at least 2 of 3 broad prompts** (human), chosen over "every time"
  (flaky with a non-deterministic model) and over a 2-site bar.
- **Small review follow-ups left out** (human): the `X-Content-Type-Options: nosniff` header on
  the server's GET /v1/icon, amending D-M10c-2's C12 line in architecture.md, and auto-restarting
  com.harness.search on new code stay recorded as follow-ups, not part of FR29–FR30.
- **Missing-separator rows: line up, accept the gap** (human, 2026-09-30, M10c3 review cycle 1
  Finding 1): when the model leaves out a column divider in a table row, the row is padded to the
  header's width, not re-split. Rows always line up and no text is lost, but a value may sit under
  the wrong heading with a blank last column. Chosen over splitting a short row on a dash or colon
  (a guessing heuristic). FR29, AC23 and M10c3-AC1 amended accordingly.
- Defaults chosen by Claude, shown to the human and agreed (2026-09-30): surplus cells are joined
  into the last column; tables apply to saved replies too; sites compared ignoring `www.`; the
  test uses the owner's usual model.
- **Always link sources, folded into FR30 / M10c4** (human, 2026-09-30, "Fold it into the next
  piece"): the model is told to write every citation as a link with the exact full URL from its
  tool results, table source cells included, so every source gets a logo. Addresses the owner's
  M10c3 AC5 remark "some have logos some don't". Guidance only, as for source diversity: no server
  check or rewrite, no phone change.
- **Link pass bar: 2 of 3 replies with 3+ linked sources and no non-matching links** (human,
  2026-09-30), measured on the same 3 broad prompts as the diversity proof; chosen over all 3
  (flaky) and over 1+ link (does not show every source getting a logo). Proven from the saved reply
  text on the Mac; no extra phone observation (FR27 matching already proven in M10c2) (default chosen
  by Claude, shown to the human and agreed).
- **Cite by number, the app supplies the address** (human, 2026-09-30, resolving the M10c4 BLOCKED
  escalation): in 4 live runs nemotron3:33b cited with `[n]`/`【】` footnotes and mistyped long URLs,
  so the link bar was 0/3 every time. The pages the model reads are now numbered and the app turns
  `[n]` into that page's logo and exact saved URL (FR31). Chosen over dropping the link bar and over
  trying another model. Supersedes, for linking only, "guidance only: no server check or rewrite, no
  phone change" in the "Always link sources" entry above; source diversity stays guidance only. The
  AC24 pass bar is unchanged in shape (2 of 3 replies, 3+ distinct sources shown with a logo, nothing
  that fails to resolve).
- **Only pages the model opened get numbers** (human, 2026-09-30): a logo always means the model
  read that page; search headlines are not numbered; the Sources list contents are unchanged.
  Chosen over numbering every search result shown (a logo could point at an unread page, and the
  Sources list would have to grow).
- Defaults chosen by Claude, shown to the human and agreed (2026-09-30): numbering per reply,
  starting at 1; `[1][3]`, `[1, 3]` and `【n】` understood; the mark is replaced by the logo; unknown
  numbers and marks in old replies stay plain text; half-written marks show as text while streaming;
  numbers saved with the sources so reopen/resume match; FR27 link logos unchanged.
- **Answer layout fix first; logos in place of written "Source: ..." deferred** (human,
  2026-09-30, "Layout fix now, logos later"): FR32 is built next, ahead of M11. The owner's request
  to show a logo instead of the model's written "Source: <name>" text is not a requirement yet: the
  first screenshot showing it (22:13) came from an always-on server still running pre-M10c4 code
  (started 13:32, before M10c4 T4 at 21:11; restarted 22:23), and the retest (22:32) opened no pages,
  so there was nothing to number. After FR32 the owner retries a few questions; only if the model
  still writes "Source: ..." in words for pages it opened is a logo swap planned. Chosen over adding
  the name-to-logo swap now and over firmer "open pages" wording now.
- **Recorded, not yet a requirement** (Claude, 2026-09-30): nothing restarts the always-on server
  (com.harness.server) when server code changes, so a finished milestone can leave the phone on old
  server code, as happened after M10c4. The 22:35 screenshot also showed `[2]`/`[3]`/`[4]` as plain
  text in a "What's happening" card line with an empty "Source:" line, i.e. numbers with no read page
  (2 web steps) in a row missing a cell separator, which is FR29/FR31 behaviour as specified. Owner
  to decide separately whether either needs action.
- **Quiet model is prodded to keep going, search still allowed** (human, 2026-10-01, "Let it keep
  searching"): chosen over one tools-off nudge then a note, and over only showing a note with no
  retry.
- **At most 2 prods, then a tools-off answer round, then a note** (human, 2026-10-01, "Yes, 2
  prods"): bounds a model that keeps going quiet without calling tools, which would otherwise never
  reach the 10-call cap. Chosen over 1 or 3 prods.
- **Prods shown as web steps** (human, 2026-10-01, "Show it as a step"): chosen over a server-only
  hidden prod, so a longer reply explains itself.
- Defaults chosen by Claude, shown to the owner and agreed (2026-10-01): FR33 is web-only;
  whitespace-only content counts as no answer; prods are not saved or re-sent and do not count as
  tool calls; the no-answer note wording and the step labels as written in FR33; the quiet case is
  proven by scripted tests rather than live, with a live regression of ordinary web replies.
- **Deep research started by the owner's button** (human, 2026-10-01): chosen over the model choosing
  a `deep_research` tool (local models under-search, so it would rarely run) and over both.
- **One run length, about 8 minutes** (human, 2026-10-01): chosen over light / normal / thorough
  presets.
- **Fast model only: `qwen3.5:35b-a3b`** (human, 2026-10-01): chosen over running on whatever model
  is loaded. The model is downloaded on the Mac (`ollama pull`) as part of this work; the phone still
  never downloads models (non-goal unchanged).
- **Wrong model: greyed out with a reason, no automatic swap** (human, 2026-10-01).
- **Stop writes a short unfinished report; a second Stop ends with none** (human, 2026-10-01): chosen
  over stopping dead with no report.
- **Proof: automated tests + 3 live questions + phone screenshot; quality opinion recorded, not
  gated** (human, 2026-10-01): chosen over building the 20-question replay set now (deferred).
- Defaults chosen by Claude, shown to the owner and agreed (2026-10-01): the action shows only with
  the web switch on and applies to one message; the model name is a Mac-side setting reported by the
  server; live steps plus an elapsed clock; about a quarter of the budget reserved for writing;
  `complete` / `partial` / `failed` shown on the reply; FR31 numbering and logos reused, unknown
  numbers removed, quotes checked by substring; report saved like any answer, page text and notes not
  saved; circuit breakers (1 h rate-limit, 24 h CAPTCHA) and 24 h caching in the search service,
  applying to ordinary web search too; reranker, PDFs, entailment check, JS-page re-fetch, presets,
  model-started runs and the 20-question set left out.
- **Fast deep research: safe fixes only** (human, 2026-10-02): ranks 0–6 of `reports/Fast local deep
  research redesign.md` become FR41–FR45. Chosen over also adding search-snippet notes and over also
  moving to the MLX model tag; those and the other amendment-needing shortcuts are deferred.
- **Phone liveness fixes for every reply** (human, 2026-10-02): keep-alive, per-outage resume
  allowance and the error line apply to ordinary and switch-off replies too (FR40 amended). Chosen
  over deep-research-only.
- **Live pass bar is the outcome; speeds recorded, not gated** (human, 2026-10-02): AC29/AC32 gate on
  finishing in time with ≥ 3 cited pages; per-call speed figures are evidence only. Chosen over
  gating on routine p50 < 10 s and planning < 40 s.
- **Standing permission to restart com.harness.server for FR41–FR45 work** (human, 2026-10-02):
  the harness may restart the always-on Mac server whenever a live test of this work needs new code.
  Limited to this work.
- **Not replacing the loop with LearningCircuit `local-deep-research`** (human, 2026-10-02, "Okay
  carry on"): it calls the same model through the same Ollama so would not fix the thinking cost; its
  published local-model scores used Serper (a paid search API, against the no-payment constraint);
  it is a separate Python app with its own login, database and SearXNG dependency; and it would
  discard FR35–FR38's built guarantees. Its useful techniques (page excerpts, parallel fetch,
  breadth-first coverage) are in FR43–FR44. A one-hour side-by-side trial was offered and declined.
- Defaults chosen by Claude, shown to the owner (2026-10-02): FR41–FR45 are built before M20; plan
  and write keep thinking under a time guard with a thinking-off fallback, all other steps think
  off; output caps ~200/~800 tokens, routine call cap ~30 s, plan guard ~30 s, write guard ~60 s,
  excerpt ~2–3K tokens, keep-alive every 15 s (all server settings); a time-out with no notes stays
  `failed` with an honest sentence; the heat-pump question joins AC29's live set.
- **Cost questions: look up prices and do the sum** (human, 2026-10-03): FR46(c)(d) — plan must
  search for current unit prices, writer shows usage × price with citations, or says no price was
  found. Chosen over adding a server re-try when no £ figure appears (more time, bigger build) and
  over quoting only page-stated £ figures (would not have fixed the M19h run).
- **Proof: heat pump ×3 plus one other cost question, 3 of 4** (human, 2026-10-03): AC35. Chosen over
  heat pump ×3 only (2 of 3) and over adding an owner phone check.
- **Built next, before M20** (human, 2026-10-03): so M21's final live run includes it.
- **Standing permission to restart com.harness.server extended to FR46 work** (human, 2026-10-03).
- Defaults chosen by Claude, shown to the owner and agreed (2026-10-03): today's date goes to every
  deep research step, not just write; no undated "current"/period claims; deep research only,
  ordinary web replies unchanged; the second live cost question is electric car vs petrol.

## Open Questions

None
