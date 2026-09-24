# Milestones

## M1 — Authenticated tailnet chat stream proof

Status: TODO

### Outcome

From Expo Go on the phone, over the tailnet only, a user can send one prompt to the currently resident Ollama model and watch the reply stream in token by token, protected by a bearer token, with Stop working.

### Architecture

C1, C2, C4, C6, C7, C8, C9, C10, C11

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M1-AC1**: With a model already resident in Ollama, sending a prompt from the Expo Go app over Tailscale Serve renders the reply incrementally, token by token, ending in a terminal complete state.
- [ ] **M1-AC2**: A request to any server route without the correct bearer token returns 401; the Mac-side command produces the token, refuses to run if the token file is group- or world-readable, and the app's settings screen accepts a pasted token and uses it on the next request.
- [ ] **M1-AC3**: Stop cancels generation on the Mac, verified against Ollama, and streaming output halts on the phone.
- [ ] **M1-AC4**: The server and the app bundle are reachable from the phone over the tailnet and are not reachable from a device on the LAN or the public internet.

### Baseline

Pending.

### Evidence

Pending.

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

## M2 — Model list, swap-load, and unload with busy confirmation

Status: TODO

### Outcome

The phone shows every installed Ollama model and the true resident state, can load (swap) or unload with a confirmation gate when busy or when another tool owns the resident model, and a loaded model stays resident indefinitely.

### Architecture

C1, C4, C5, C7

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M2-AC1**: The app's model list matches Ollama GET /api/tags by real name and size, with no hardcoded model names.
- [ ] **M2-AC2**: Loading model A then model B leaves only B resident in GET /api/ps; unloading leaves nothing resident.
- [ ] **M2-AC3**: A model loaded from the phone remains resident in GET /api/ps after 10 minutes idle and after a chat reply completes.
- [ ] **M2-AC4**: Swapping or unloading while a reply is in flight, or while the resident model was not loaded by this server, requires explicit confirmation, and cancelling the confirmation leaves state unchanged.
- [ ] **M2-AC5**: A failed load, such as out of memory, leaves nothing resident and the app shows the failure reason.

### Baseline

Pending.

### Evidence

Pending.

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

## M3 — Persisted multi-turn conversations with model attribution

Status: TODO

### Outcome

The phone keeps a list of conversations, each with full multi-turn history sent on every prompt, each reply labeled with the model that produced it, and conversations survive an app restart.

### Architecture

C1, C3

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M3-AC1**: Conversations can be created, opened and deleted, and are listed newest first.
- [ ] **M3-AC2**: A follow-up prompt in the same conversation demonstrably uses context from an earlier turn.
- [ ] **M3-AC3**: Each assistant reply displays the model name that produced it, including after a mid-conversation model switch.
- [ ] **M3-AC4**: Sending with no model resident is blocked with a prompt to load one.
- [ ] **M3-AC5**: Force-quitting and reopening Expo Go shows the same conversations and messages as before.

### Baseline

Pending.

### Evidence

Pending.

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

## M4 — Thinking display and dropped-connection resume

Status: TODO

### Outcome

Reasoning output appears collapsed and expandable, separate from the answer, and a transport drop or app backgrounding mid-reply resumes cleanly with no gaps or duplication once the phone reconnects.

### Architecture

C1, C2, C3, C6

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M4-AC1**: For a model that emits reasoning output, the app shows it in a collapsed, expandable section separate from the answer.
- [ ] **M4-AC2**: Killing the connection mid-reply and reconnecting yields the complete reply with no gaps and no duplicated text.
- [ ] **M4-AC3**: Backgrounding the app mid-reply and returning to foreground resumes the same reply and receives its terminal state, with only an explicit Stop cancelling generation.

### Baseline

Pending.

### Evidence

Pending.

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.

## M5 — Always-on Mac tooling, plain-language errors, and PWA retirement

Status: TODO

### Outcome

The server and app bundle host survive a Mac reboot with no manual step, every failure mode shows a distinct plain-language message, and the old PWA is retired without disturbing the harness's own endpoint.

### Architecture

C4, C8, C9

### As-Built

Pending.

### Acceptance Criteria

- [ ] **M5-AC1**: After a Mac reboot, opening the project in Expo Go on the phone works with no manual step on the Mac.
- [ ] **M5-AC2**: Killing either the server process or the bundle host process causes it to restart automatically.
- [ ] **M5-AC3**: The app shows a distinct message for each of: Mac or server unreachable, Ollama down, wrong password, model failed to load, model no longer installed, and reply already in progress.
- [ ] **M5-AC4**: After retirement, /app no longer resolves, the PWA's LaunchAgent is gone, and the harness's / handler still works.

### Baseline

Pending.

### Evidence

Pending.

### Validation

Pending.

### Review

Pending.

### Review Cycles

0

### Follow-ups

None.
