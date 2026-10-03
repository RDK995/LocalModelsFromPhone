"""Search helper (I17): ddgs text search, one JSON object on stdout, always exit 0.

When ddgs raises or returns nothing usable, a headless Chromium (Playwright) is started on demand,
loads a Bing results page (UK / English), scrapes the result links and is always closed again.

Test-only hooks:
- env SEARCH_HELPER_FORCE_DDGS = "fail" makes the ddgs step behave as if it raised ("forced failure");
  "empty" makes it behave as if it returned zero results. Any other value or unset means normal behaviour.
  It never affects the browser step.
- env SEARCH_HELPER_FORCE_BROWSER = "fail" makes the browser step behave as if it raised, without
  launching a browser. "hang" sleeps for a long time after launching, simulating a slow search holding
  a live browser. "captcha" makes it behave as if Bing served a challenge page (outcome "captcha"),
  without launching a browser. Any other value or unset means normal behaviour.
- env SEARCH_HELPER_FORCE_DDGS = "ratelimit" / "captcha" makes every ddgs engine attempt behave as if it
  was rate limited / shown a CAPTCHA (outcome "rate_limited" / "captcha"), without the network.

Optional arguments (I17 extension, FR39):
- --backends a,b,c  ordered allowed ddgs engines; each is tried on its own (one engine per ddgs call, so a
  failure is attributable) until one returns a usable result. Empty string means no ddgs call at all.
  Absent means one ordinary ddgs call.
- --no-browser  skip the browser step (the caller is resting it).

Output always carries "attempts": [{"backend": <engine | "ddgs" | "browser">, "outcome": <outcome>}, ...]
in the order tried, with outcome one of ok | empty | rate_limited | captcha | error.
"""
import argparse
import base64
import json
import os
import sys
import time
from urllib.parse import parse_qs, quote_plus, urlparse

_sleep = time.sleep

REGION = "uk-en"
MIN_MAX, MAX_MAX = 1, 10
NAV_TIMEOUT_MS = 20000
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError(message)


ENGINE_TIMEOUT_S = 4

RATE_LIMIT_MARKERS = ("429", "too many requests", "ratelimit", "rate limit")
CAPTCHA_MARKERS = ("captcha", "bot check", "unusual traffic", "are you a robot", "anomaly")


def _default_factory(timeout=None):
    from ddgs import DDGS

    return DDGS(timeout=timeout) if timeout else DDGS()


def classify_failure(exc):
    """Map an exception to 'rate_limited', 'captcha' or 'error'."""
    text = f"{type(exc).__name__} {exc}".lower()
    if "RatelimitException" in [c.__name__ for c in type(exc).__mro__]:
        return "rate_limited"
    if any(m in text for m in RATE_LIMIT_MARKERS):
        return "rate_limited"
    if any(m in text for m in CAPTCHA_MARKERS):
        return "captcha"
    return "error"


def is_challenge_text(text):
    """True when page title/body text looks like a CAPTCHA / bot-check page."""
    lowered = (text or "").lower()
    return any(m in lowered for m in CAPTCHA_MARKERS)


class ChallengeError(Exception):
    """The browser was shown a challenge page instead of results."""


def pick_title(inner_text, text_content, aria_label, title_attr):
    """Pick the best title using fallback strategy: innerText, textContent, aria-label, title attr."""
    # Try innerText first (stripped)
    if inner_text and inner_text.strip():
        return inner_text.strip()
    # Try textContent (stripped with whitespace collapsed)
    if text_content and text_content.strip():
        return " ".join(text_content.split())
    # Try aria-label (stripped)
    if aria_label and aria_label.strip():
        return aria_label.strip()
    # Try title attribute (stripped)
    if title_attr and title_attr.strip():
        return title_attr.strip()
    # All empty
    return ""


def decode_bing_href(href):
    """Return the real destination of a Bing result href, or None if it cannot be resolved."""
    try:
        parsed = urlparse(href or "")
        host = (parsed.hostname or "").lower()
        if host.endswith("bing.com") and parsed.path.startswith("/ck/"):
            token = (parse_qs(parsed.query).get("u") or [""])[0]
            if not token.startswith("a1"):
                return None
            token = token[2:]
            real = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)).decode("utf-8")
        else:
            real = href
        p = urlparse(real)
        if p.scheme not in ("http", "https") or not p.hostname:
            return None
        h = p.hostname.lower()
        if h == "bing.com" or h.endswith(".bing.com"):
            return None
        return real
    except Exception:  # noqa: BLE001 - undecodable result is simply dropped
        return None


def _raise_if_challenge(page):
    try:
        seen = page.evaluate(
            """() => (document.title || '') + ' ' + (document.body ? document.body.innerText : '')
                + (document.querySelector('#b_captcha, iframe[src*="captcha"], .captcha') ? ' captcha' : '')"""
        )
    except Exception:  # noqa: BLE001 - detection is best effort
        return
    if isinstance(seen, str) and is_challenge_text(seen):
        raise ChallengeError("captcha: Bing served a challenge page")


def browser_search(query, max_results, sync_playwright=None):
    """Load a Bing results page in headless Chromium and scrape it. Always closes the browser."""
    if sync_playwright is None:
        from playwright.sync_api import sync_playwright
    url = f"https://www.bing.com/search?q={quote_plus(query)}&cc=GB&setlang=en-GB&form=QBLH"
    words = [w.lower() for w in query.split() if len(w) > 2] or [query.lower()]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        # Test-only hook: simulate a slow search holding a live browser
        if os.environ.get("SEARCH_HELPER_FORCE_BROWSER") == "hang":
            _sleep(3600)
        try:
            context = browser.new_context(
                locale="en-GB",
                user_agent=USER_AGENT,
                extra_http_headers={"Accept-Language": "en-GB,en;q=0.9"},
            )
            page = context.new_page()
            page.set_default_timeout(NAV_TIMEOUT_MS)
            results = []
            # Bing occasionally serves an unrelated result page to headless browsers; a page whose
            # results never mention any query word is treated as unusable and loaded once more.
            for _attempt in range(2):
                page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
                try:
                    # Bing redirects once (adds rdr=1) before the real results are rendered.
                    page.wait_for_url("**rdr=1**", timeout=NAV_TIMEOUT_MS)
                    page.wait_for_selector("li.b_algo h2 a", timeout=NAV_TIMEOUT_MS)
                except Exception:  # noqa: BLE001 - zero results is handled by the caller
                    pass
                rows = page.evaluate(
                    """() => Array.from(document.querySelectorAll('li.b_algo')).map(li => {
                        const a = li.querySelector('h2 a');
                        const p = li.querySelector('.b_caption p, p');
                        return {
                            innerText: a ? a.innerText : '',
                            textContent: a ? a.textContent : '',
                            ariaLabel: a ? a.getAttribute('aria-label') : '',
                            titleAttr: a ? a.getAttribute('title') : '',
                            href: a ? a.href : '',
                            snippet: p ? p.innerText : ''
                        };
                    })"""
                )
                if not rows:
                    _raise_if_challenge(page)
                results, seen = [], set()
                for row in rows or []:
                    real = decode_bing_href(row.get("href"))
                    if not real or real in seen:
                        continue
                    seen.add(real)
                    title = pick_title(
                        row.get("innerText") or "",
                        row.get("textContent") or "",
                        row.get("ariaLabel") or "",
                        row.get("titleAttr") or ""
                    )
                    if not title:
                        continue
                    results.append(
                        {"title": title, "url": real, "snippet": (row.get("snippet") or "").strip()}
                    )
                    if len(results) >= max_results:
                        break
                text = " ".join(f"{r['title']} {r['url']} {r['snippet']}" for r in results).lower()
                if results and any(w in text for w in words):
                    return results
            return []
        finally:
            browser.close()


def _normalise(hits):
    results = []
    for hit in hits or []:
        url = (hit.get("href") or "").strip()
        if not url:
            continue
        results.append({"title": hit.get("title") or "", "url": url, "snippet": hit.get("body") or ""})
    return results


def _ddgs_attempt(query, max_results, ddgs_factory, engine=None):
    """One ddgs call. Returns (results, outcome, why); why is None when outcome is 'ok'."""
    forced = os.environ.get("SEARCH_HELPER_FORCE_DDGS")
    if forced == "fail":
        return [], "error", "forced failure"
    if forced == "empty":
        return [], "empty", "no results"
    if forced == "ratelimit":
        return [], "rate_limited", "forced rate limit"
    if forced == "captcha":
        return [], "captcha", "forced captcha"
    try:
        if engine is None:
            client = (ddgs_factory or _default_factory)()
            hits = client.text(query, region=REGION, safesearch="moderate", max_results=max_results)
        else:
            client = (ddgs_factory or _default_factory)(timeout=ENGINE_TIMEOUT_S)
            hits = client.text(
                query, region=REGION, safesearch="moderate", max_results=max_results, backend=engine
            )
        results = _normalise(hits)
        if results:
            return results, "ok", None
        return [], "empty", "no results"
    except Exception as e:  # noqa: BLE001 - contract: report, never raise
        return [], classify_failure(e), f"{type(e).__name__}: {e}"


def _browser_attempt(query, max_results, browser_search):
    """Returns (results, outcome, why)."""
    forced = os.environ.get("SEARCH_HELPER_FORCE_BROWSER")
    if forced == "fail":
        return [], "error", "forced failure"
    if forced == "captcha":
        return [], "captcha", "forced captcha"
    try:
        found = browser_search(query, max_results)
    except Exception as e:  # noqa: BLE001 - contract: report, never raise
        return [], classify_failure(e), f"{type(e).__name__}: {e}"
    if found:
        return found, "ok", None
    return [], "empty", "no results"


def run(query, max_results, ddgs_factory=None, browser_search=None, backends=None, use_browser=True):
    """browser_search=None disables the browser fallback (ddgs-only); main() passes the real one.

    backends=None: one ordinary ddgs call. A list: each engine tried alone, in order (empty list: no ddgs
    call). use_browser=False skips the browser step (it is resting) and records no browser attempt."""
    max_results = max(MIN_MAX, min(MAX_MAX, max_results))
    attempts, whys = [], []
    names = ["ddgs"] if backends is None else list(backends)
    for name in names:
        results, outcome, why = _ddgs_attempt(
            query, max_results, ddgs_factory, None if backends is None else name
        )
        attempts.append({"backend": name, "outcome": outcome})
        if why is None:
            return {"results": results, "backend": name, "attempts": attempts}
        whys.append(why if backends is None else f"{name}: {why}")
    ddgs_detail = "; ".join(whys) if whys else "no ddgs backend allowed"
    all_empty = bool(attempts) and all(a["outcome"] == "empty" for a in attempts)
    if browser_search is None or not use_browser:
        if all_empty:
            return {"results": [], "backend": attempts[-1]["backend"], "attempts": attempts}
        return {"error": "search_failed", "detail": ddgs_detail, "attempts": attempts}
    found, outcome, bwhy = _browser_attempt(query, max_results, browser_search)
    attempts.append({"backend": "browser", "outcome": outcome})
    if bwhy is None:
        return {"results": found[:max_results], "backend": "browser", "attempts": attempts}
    return {
        "error": "search_failed",
        "detail": f"ddgs: {ddgs_detail}; browser: {bwhy}",
        "attempts": attempts,
    }


def main(argv=None):
    parser = _Parser(prog="search.py")
    parser.add_argument("--query", required=True)
    parser.add_argument("--max", type=int, default=5)
    parser.add_argument("--backends", default=None)
    parser.add_argument("--no-browser", action="store_true")
    try:
        args = parser.parse_args(argv)
        query = args.query.strip()
        if not query:
            raise ValueError("--query must not be empty")
        backends = None
        if args.backends is not None:
            backends = [b.strip() for b in args.backends.split(",") if b.strip()]
        out = run(
            query, args.max, browser_search=browser_search, backends=backends, use_browser=not args.no_browser
        )
    except ValueError as e:
        out = {"error": "bad_request", "detail": str(e)}
    sys.stdout.write(json.dumps(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
