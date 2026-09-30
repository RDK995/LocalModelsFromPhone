import base64
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

import search

SCRIPT = Path(__file__).parent / "search.py"


def fake_factory(hits=None, exc=None, calls=None):
    class FakeDDGS:
        def text(self, query, **kwargs):
            if calls is not None:
                calls.append((query, kwargs))
            if exc is not None:
                raise exc
            return hits or []

    return FakeDDGS


class RunTests(unittest.TestCase):
    def test_uses_uk_region_and_max(self):
        calls = []
        search.run("ada", 3, ddgs_factory=fake_factory([], calls=calls))
        self.assertEqual(calls[0][0], "ada")
        self.assertEqual(calls[0][1]["region"], "uk-en")
        self.assertEqual(calls[0][1]["max_results"], 3)

    def test_normalises_hits_and_skips_missing_url(self):
        hits = [
            {"title": "T", "href": "https://a.example", "body": "B"},
            {"title": "No url", "href": "", "body": "x"},
        ]
        out = search.run("q", 5, ddgs_factory=fake_factory(hits))
        self.assertEqual(
            out,
            {"results": [{"title": "T", "url": "https://a.example", "snippet": "B"}], "backend": "ddgs"},
        )

    def test_zero_results(self):
        self.assertEqual(
            search.run("q", 5, ddgs_factory=fake_factory([])),
            {"results": [], "backend": "ddgs"},
        )

    def test_exception_gives_search_failed(self):
        out = search.run("q", 5, ddgs_factory=fake_factory(exc=RuntimeError("boom")))
        self.assertEqual(out, {"error": "search_failed", "detail": "RuntimeError: boom"})

    def test_max_clamped(self):
        calls = []
        search.run("q", 99, ddgs_factory=fake_factory([], calls=calls))
        search.run("q", 0, ddgs_factory=fake_factory([], calls=calls))
        self.assertEqual([c[1]["max_results"] for c in calls], [10, 1])


def fake_browser(results=None, exc=None, calls=None):
    def fn(query, max_results):
        if calls is not None:
            calls.append((query, max_results))
        if exc is not None:
            raise exc
        return results or []

    return fn


GOOD = [{"title": "T", "url": "https://a.example", "snippet": "B"}]
HIT = [{"title": "T", "href": "https://d.example", "body": "B"}]


class FallbackTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("SEARCH_HELPER_FORCE_DDGS", None)

    def test_ddgs_raises_uses_browser(self):
        calls = []
        out = search.run("q", 5, fake_factory(exc=RuntimeError("boom")), fake_browser(GOOD, calls=calls))
        self.assertEqual(out, {"results": GOOD, "backend": "browser"})
        self.assertEqual(calls, [("q", 5)])

    def test_ddgs_empty_uses_browser(self):
        calls = []
        out = search.run("q", 5, fake_factory([]), fake_browser(GOOD, calls=calls))
        self.assertEqual(out["backend"], "browser")
        self.assertEqual(len(calls), 1)

    def test_ddgs_ok_skips_browser(self):
        calls = []
        out = search.run("q", 5, fake_factory(HIT), fake_browser(GOOD, calls=calls))
        self.assertEqual(out["backend"], "ddgs")
        self.assertEqual(calls, [])

    def test_browser_raises_reports_both(self):
        out = search.run("q", 5, fake_factory(exc=RuntimeError("boom")), fake_browser(exc=ValueError("nav")))
        self.assertEqual(
            out, {"error": "search_failed", "detail": "ddgs: RuntimeError: boom; browser: ValueError: nav"}
        )

    def test_browser_empty_is_search_failed(self):
        out = search.run("q", 5, fake_factory([]), fake_browser([]))
        self.assertEqual(out, {"error": "search_failed", "detail": "ddgs: no results; browser: no results"})

    def test_env_fail_and_empty_route_to_browser(self):
        for mode, why in (("fail", "forced failure"), ("empty", "no results")):
            os.environ["SEARCH_HELPER_FORCE_DDGS"] = mode
            calls = []
            out = search.run("q", 5, fake_factory(HIT), fake_browser(GOOD, calls=calls))
            self.assertEqual(out["backend"], "browser", mode)
            self.assertEqual(len(calls), 1, mode)
            out = search.run("q", 5, fake_factory(HIT), fake_browser([]))
            self.assertEqual(out["detail"], f"ddgs: {why}; browser: no results")

    def test_decode_bing_redirect(self):
        real = "https://en.wikipedia.org/wiki/Ada_Lovelace"
        token = "a1" + base64.urlsafe_b64encode(real.encode()).decode().rstrip("=")
        href = f"https://www.bing.com/ck/a?!&&p=abc&u={token}&ntb=1"
        self.assertEqual(search.decode_bing_href(href), real)
        self.assertEqual(search.decode_bing_href("https://example.org/x"), "https://example.org/x")
        self.assertIsNone(search.decode_bing_href("https://www.bing.com/ck/a?u=zzzz"))
        self.assertIsNone(search.decode_bing_href("https://www.bing.com/images/search?q=x"))
        self.assertIsNone(search.decode_bing_href("javascript:void(0)"))

    def test_browser_closed_when_scrape_raises(self):
        events = []

        class Page:
            def set_default_timeout(self, ms):
                pass

            def goto(self, *a, **k):
                raise TimeoutError("nav")

        class Ctx:
            def new_page(self):
                return Page()

        class Browser:
            def new_context(self, **k):
                return Ctx()

            def close(self):
                events.append("browser closed")

        class PW:
            chromium = type("C", (), {"launch": staticmethod(lambda headless: Browser())})

            def __enter__(self):
                return self

            def __exit__(self, *a):
                events.append("playwright stopped")

        with self.assertRaises(TimeoutError):
            search.browser_search("q", 5, sync_playwright=lambda: PW())
        self.assertEqual(events, ["browser closed", "playwright stopped"])


class CliTests(unittest.TestCase):
    def run_cli(self, *args):
        p = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0)
        return json.loads(p.stdout)

    def test_missing_query(self):
        out = self.run_cli()
        self.assertEqual(out["error"], "bad_request")
        self.assertTrue(out["detail"])

    def test_blank_query(self):
        self.assertEqual(self.run_cli("--query", "   ")["error"], "bad_request")

    def test_bad_max(self):
        self.assertEqual(self.run_cli("--query", "x", "--max", "abc")["error"], "bad_request")


if __name__ == "__main__":
    unittest.main()
