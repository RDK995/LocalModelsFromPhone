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

## Constraints

- Runs in **Expo Go** only: current Expo SDK, no custom native modules, no development build.
  Libraries must be Expo Go–compatible (e.g. secure storage and streaming fetch as provided by
  Expo).
- Mac-side code targets **Bun**, matching the neighbouring projects.
- Ollama at `127.0.0.1:11434` is the only model runtime. It exposes no per-model "in use" signal.
- Mac Studio has ~64 GB RAM; installed models are ~14–28 GB each.
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

## Open Questions

None
