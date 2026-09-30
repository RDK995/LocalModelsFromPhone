"""Search helper (I17): ddgs text search, one JSON object on stdout, always exit 0.

When ddgs raises or returns nothing usable, a headless Chromium (Playwright) is started on demand,
loads a Bing results page (UK / English), scrapes the result links and is always closed again.

Test-only hook: env SEARCH_HELPER_FORCE_DDGS = "fail" makes the ddgs step behave as if it raised
("forced failure"); "empty" makes it behave as if it returned zero results. Any other value or
unset means normal behaviour. It never affects the browser step.
"""
import argparse
import base64
import json
import os
import sys
from urllib.parse import parse_qs, quote_plus, urlparse

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


def _default_factory():
    from ddgs import DDGS

    return DDGS()


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
        if h == "bing.com" or h.endswith(".bing.com") or h.endswith(".microsoft.com"):
            return None
        return real
    except Exception:  # noqa: BLE001 - undecodable result is simply dropped
        return None


def browser_search(query, max_results, sync_playwright=None):
    """Load a Bing results page in headless Chromium and scrape it. Always closes the browser."""
    if sync_playwright is None:
        from playwright.sync_api import sync_playwright
    url = f"https://www.bing.com/search?q={quote_plus(query)}&cc=GB&setlang=en-GB&form=QBLH"
    words = [w.lower() for w in query.split() if len(w) > 2] or [query.lower()]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
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
                        return {title: a ? a.innerText : '', href: a ? a.href : '', snippet: p ? p.innerText : ''};
                    })"""
                )
                results, seen = [], set()
                for row in rows or []:
                    real = decode_bing_href(row.get("href"))
                    if not real or real in seen:
                        continue
                    seen.add(real)
                    results.append(
                        {"title": (row.get("title") or "").strip(), "url": real, "snippet": (row.get("snippet") or "").strip()}
                    )
                    if len(results) >= max_results:
                        break
                text = " ".join(f"{r['title']} {r['url']} {r['snippet']}" for r in results).lower()
                if results and any(w in text for w in words):
                    return results
            return []
        finally:
            browser.close()


def _ddgs_step(query, max_results, ddgs_factory):
    """Return (results, why_not). why_not is None when there is at least one usable result."""
    forced = os.environ.get("SEARCH_HELPER_FORCE_DDGS")
    if forced == "fail":
        return [], "forced failure"
    if forced == "empty":
        return [], "no results"
    try:
        client = (ddgs_factory or _default_factory)()
        hits = client.text(query, region=REGION, safesearch="moderate", max_results=max_results)
        results = []
        for hit in hits or []:
            url = (hit.get("href") or "").strip()
            if not url:
                continue
            results.append({"title": hit.get("title") or "", "url": url, "snippet": hit.get("body") or ""})
        return results, (None if results else "no results")
    except Exception as e:  # noqa: BLE001 - contract: report, never raise
        return [], f"{type(e).__name__}: {e}"


def run(query, max_results, ddgs_factory=None, browser_search=None):
    """browser_search=None disables the browser fallback (ddgs-only); main() passes the real one."""
    max_results = max(MIN_MAX, min(MAX_MAX, max_results))
    results, why = _ddgs_step(query, max_results, ddgs_factory)
    if why is None:
        return {"results": results, "backend": "ddgs"}
    if browser_search is None:
        if why == "no results":
            return {"results": [], "backend": "ddgs"}
        return {"error": "search_failed", "detail": why}
    try:
        found = browser_search(query, max_results)
        bwhy = None if found else "no results"
    except Exception as e:  # noqa: BLE001 - contract: report, never raise
        found, bwhy = [], f"{type(e).__name__}: {e}"
    if bwhy is None:
        return {"results": found[:max_results], "backend": "browser"}
    return {"error": "search_failed", "detail": f"ddgs: {why}; browser: {bwhy}"}


def main(argv=None):
    parser = _Parser(prog="search.py")
    parser.add_argument("--query", required=True)
    parser.add_argument("--max", type=int, default=5)
    try:
        args = parser.parse_args(argv)
        query = args.query.strip()
        if not query:
            raise ValueError("--query must not be empty")
        out = run(query, args.max, browser_search=browser_search)
    except ValueError as e:
        out = {"error": "bad_request", "detail": str(e)}
    sys.stdout.write(json.dumps(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
