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

## Non-Goals

- App Store, TestFlight, or standalone (development/production) builds; own home-screen icon.
- Android.
- Any change to the OpenWeight harness.
- Chatting through OpenCode, or sending OpenCode coding jobs from the phone.
- Downloading, deleting or configuring models.
- More than one model resident at once from phone actions.
- Tier/profile labels.
- Images, voice, tool use.
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

## Open Questions

None
