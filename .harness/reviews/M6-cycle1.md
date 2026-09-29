# M6 review — cycle 1 (full milestone)

Diff: `git diff 662d1901ad22979562feda4dc08ac68a6fdda028 HEAD` on `m6-search-read-page`.

Validation re-run by reviewer against HEAD (6d57379):
`cd search && bun install && bun test && bun run typecheck && bash scripts/read-proof.sh && ! lsof -nP -iTCP:7790 -sTCP:LISTEN`
→ exit 0. bun test: 115 pass, 0 fail. typecheck clean. read-proof.sh: ALL CASES PASSED. Port 7790 free afterwards.
Full output: `.harness/evidence/M6-review.log`.

Verdict: **CHANGES REQUIRED** (1 IMPORTANT finding; all criteria PASS)

## Acceptance criteria

```
Acceptance Criterion:
M6-AC1 — POST /v1/read on 127.0.0.1:7790 with a real public article URL returns 200 with its main
text as markdown (boilerplate removed) and truncated false; a page longer than the size limit comes
back truncated true with a truncation marker.

Implementation Evidence:
search/src/extract/extract.ts (Defuddle over linkedom, 40 000-char cut + marker);
search/src/http/server.ts (POST /v1/read, 200 {url, final_url, title, markdown, truncated});
search/src/index.ts (127.0.0.1:7790).

Test Evidence:
search/src/extract/extract.test.ts (boilerplate stripped, over-long → truncated + marker);
search/src/http/server.test.ts "200 success path returns extracted markdown";
scripts/read-proof.sh AC1 live: en.wikipedia.org/wiki/Ada_Lovelace_Day → 200, truncated false,
body sentence present, three raw-HTML boilerplate strings absent; wiki/World_War_II → 200,
truncated true, ends with marker (re-run by reviewer).

Result:
PASS
```

```
Acceptance Criterion:
M6-AC2 — refuses with 400 blocked_destination http://127.0.0.1:7789, http://localhost, a 100.x
tailnet address, a 192.168.x.x address, http://[::1], and a hostname that resolves to 127.0.0.1;
the check is made on the address actually connected to (no DNS-rebinding gap).

Implementation Evidence:
search/src/fetch/fetchPage.ts requestOnce (IP-literal check before connect; custom `lookup` that
checks every resolved record and hands the socket exactly the checked address);
search/src/fetch/addressPolicy.ts isPublicAddress.

Test Evidence:
fetchPage.test.ts "R6: Bun honours the custom lookup" suite (injected resolver used for a .invalid
name; hostname→127.0.0.1 refused with zero connections; mixed public/private refused; mapped
::ffff:127.0.0.1 refused; real `localhost` refused) and "IP literal hosts" suite;
addressPolicy.test.ts; server.test.ts blocked literals;
read-proof.sh AC2 live: all six listed cases + this Mac's tailnet IP, plus a sentinel listener
that received zero requests (with a positive control) (re-run by reviewer).

Result:
PASS
```

```
Acceptance Criterion:
M6-AC3 — a public URL that redirects to any blocked destination is refused (every hop
re-checked), and a non-http(s) scheme returns 400 bad_url.

Implementation Evidence:
search/src/fetch/fetchPage.ts fetchPage redirect loop (manual, max 5; each hop goes through
requestOnce and its checks); parseHttpUrl → bad_url.

Test Evidence:
fetchPage.test.ts "redirects" suite (hop to a private-resolving host and to a [::1] literal are
refused after exactly one request) and "URL validation" suite; server.test.ts ftp → bad_url;
read-proof.sh AC3 live: httpbin redirect-to 127.0.0.1:7789 and 100.100.100.100 → 400
blocked_destination; file:///etc/passwd and ftp:// → 400 bad_url (re-run by reviewer).

Result:
PASS
```

```
Acceptance Criterion:
M6-AC4 — non-text content returns 415 unsupported_content, and a fetch exceeding its time limit
returns 504 timeout instead of hanging.

Implementation Evidence:
search/src/fetch/fetchPage.ts ALLOWED_TYPES check and single 15 s deadline covering all hops
and the body; search/src/http/server.ts STATUS_BY_CODE.

Test Evidence:
fetchPage.test.ts "limits" suite (image/png, pdf, octet-stream, missing type → unsupported;
no-response and stalled-body → timeout); server.test.ts 415 and 504;
read-proof.sh AC4 live: httpbin image/png → 415; drip delay=20 → 504 timeout in 15.0 s
(re-run by reviewer).

Result:
PASS
```

## Findings

```
Severity:
IMPORTANT

Problem:
Page extraction makes its own outbound web requests that bypass the SSRF-guarded fetcher.
`extractPage` calls `Defuddle(document, finalUrl, { markdown: true })` from `defuddle/node`,
which always runs `parseAsync()`. With `useAsync` not set to false, Defuddle's async extractors
(X/Twitter oEmbed + FxTwitter, Reddit, YouTube, Bilibili, C2 wiki) issue requests through
`globalThis.fetch` — Bun's fetch, with none of I18's guard, no 5 MiB cap, not covered by the
15 s deadline, and not aborted on client disconnect. Extractor selection uses
`domain.includes(pattern)`, so unrelated sites trigger it: reading
`https://www.dropbox.com/s/abc/status/123` (hostname contains "x.com") makes the service send the
page URL to `api.fxtwitter.com` and `publish.twitter.com`, and can replace the page's own content
with a third party's.

Evidence:
search/src/extract/extract.ts:33 (Defuddle call without `useAsync: false` or a `fetch` option);
search/node_modules/defuddle/dist/node.js:71 (`parseAsync()`);
search/node_modules/defuddle/dist/extractors/_base.js:11-14 (`options.fetch || globalThis.fetch`);
extractors/x-oembed.js:46-47,100-101; extractors/reddit.js:106-109,149-150;
extractors/youtube.js:553,686-778; extractor-registry.js:218-224 (`domain.includes(pattern)`).
Reviewer probe (stubbed globalThis.fetch, extractPage with finalUrl
https://www.dropbox.com/s/abc/status/123) recorded calls to
https://api.fxtwitter.com/abc/status/123 and
https://publish.twitter.com/oembed?url=https%3A%2F%2Fwww.dropbox.com%2Fs%2Fabc%2Fstatus%2F123.

Why it matters:
Architecture I18 says the page fetch goes through node:http(s) with the guarded lookup, the
5 MiB/15 s caps, and that client disconnect aborts the work; FR21 says page reading happens
"safely" with byte and time limits. These extra requests are an undeclared second network path
out of C13 (architectural drift, not recorded under ## Deviations). They leak the URLs being read
to third parties, can push a read well past the 15 s deadline, and keep running after the caller
disconnects. Today the destinations are fixed third-party hosts, so this is not a direct
loopback SSRF, but a library upgrade could change that without anyone noticing, because
nothing tests that extraction stays offline.

Suggested correction:
Conform to the agreed architecture (recommended): pass `useAsync: false` to Defuddle in
extract.ts, and also pass a `fetch` option that throws, so no future extractor can reach the
network. Add a test to extract.test.ts that replaces `globalThis.fetch` with a recorder,
extracts a page whose finalUrl matches an async extractor (for example an x.com status URL or a
www.reddit.com/r/x/comments/... URL), and asserts zero calls. Recording this as a deviation
instead is not recommended: it would allow unguarded, uncapped outbound requests from the
component whose job is to be the guarded one.
```

## Notes (not findings)

- gzip/deflate/br decoding in fetchPage.ts (flagged as beyond the task packet) is in scope: real
  sites ignore `Accept-Encoding: identity`, and the byte cap is applied after decompression.
- A redirect to a non-http(s) scheme returns blocked_destination rather than bad_url. This is
  consistent with AC3, where bad_url is about the caller's own URL.
- An empty 499 on client abort is acceptable under I16, which only requires that the work is
  aborted.
