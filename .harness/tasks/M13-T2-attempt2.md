Previous Attempt (M13-T2, attempt 1, Cheap/haiku) — FAIL against the packet's Goal

What was done: mobile/src/ui/webFailureDisplay.test.ts (5 tests) builds Message objects by hand with `steps` and passes them to buildChatItems()/stepLabel(). Those tests pass and the RED check works; KEEP that file as it is.

Why it failed: the packet's Goal says "Drive it through the same path real streamed events take in the app", with the fallback allowed only "if the store cannot be driven in a test without new production code". The verifier found it CAN be: mobile/src/chat/conversationSession.test.ts already drives a real APIClient over a fake fetch into a real createConversationStore (test "stores steps and sources from a web search response"), but only with step statuses "started"/"done". No test drives streamed "unavailable"/"failed" steps.

What attempt 2 must add (to webFailureDisplay.test.ts, or a new describe block in a new file mobile/src/chat/webFailureSession.test.ts — your choice, follow conversationSession.test.ts's helpers by copying the minimal ones, do not edit that existing file):
- Using sendInConversation with a real APIClient over a fake fetch whose SSE body contains: step(search, started) -> step(search, unavailable, detail search_unavailable) -> content tokens -> done (normal status), assert the stored assistant message has the unavailable step and the full answer text, is no longer in progress, and buildChatItems on the stored conversation yields an item labelled "Search unavailable" plus the answer text.
- Same for a search step failed with detail "timeout", and a read step failed with detail "timeout" -> "(failed)" labels and the answer.
- Look at how the existing web-search-response test formats the SSE events and the done event; match it exactly.
- RED: temporarily break something on that path (e.g. make the store drop steps whose status is not "done", or change "Search unavailable"), show the new streamed tests fail, restore; append the output to .harness/evidence/M13-T2-red.log.

Escalated: none (attempt 2 stays at Cheap).
