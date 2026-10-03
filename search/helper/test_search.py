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


class PickTitleTests(unittest.TestCase):
    def test_pick_title_uses_inner_text_when_present(self):
        self.assertEqual(search.pick_title("Ada Lovelace", "different", "", ""), "Ada Lovelace")

    def test_pick_title_strips_inner_text(self):
        self.assertEqual(search.pick_title("  Ada Lovelace  ", "", "", ""), "Ada Lovelace")

    def test_pick_title_falls_back_to_text_content(self):
        self.assertEqual(search.pick_title("", "Ada Lovelace", "", ""), "Ada Lovelace")

    def test_pick_title_collapses_whitespace_in_text_content(self):
        self.assertEqual(search.pick_title("", "Ada  \n  Lovelace  ", "", ""), "Ada Lovelace")

    def test_pick_title_falls_back_to_aria_label(self):
        self.assertEqual(search.pick_title("", "", "Ada Lovelace", ""), "Ada Lovelace")

    def test_pick_title_strips_aria_label(self):
        self.assertEqual(search.pick_title("", "", "  Ada Lovelace  ", ""), "Ada Lovelace")

    def test_pick_title_falls_back_to_title_attr(self):
        self.assertEqual(search.pick_title("", "", "", "Ada Lovelace"), "Ada Lovelace")

    def test_pick_title_strips_title_attr(self):
        self.assertEqual(search.pick_title("", "", "", "  Ada Lovelace  "), "Ada Lovelace")

    def test_pick_title_all_empty_returns_empty(self):
        self.assertEqual(search.pick_title("", "", "", ""), "")

    def test_pick_title_all_whitespace_returns_empty(self):
        self.assertEqual(search.pick_title("   ", "  \n  ", "\t", "  "), "")


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
            {
                "results": [{"title": "T", "url": "https://a.example", "snippet": "B"}],
                "backend": "ddgs",
                "attempts": [{"backend": "ddgs", "outcome": "ok"}],
            },
        )

    def test_zero_results(self):
        self.assertEqual(
            search.run("q", 5, ddgs_factory=fake_factory([])),
            {"results": [], "backend": "ddgs", "attempts": [{"backend": "ddgs", "outcome": "empty"}]},
        )

    def test_exception_gives_search_failed(self):
        out = search.run("q", 5, ddgs_factory=fake_factory(exc=RuntimeError("boom")))
        self.assertEqual(
            out,
            {
                "error": "search_failed",
                "detail": "RuntimeError: boom",
                "attempts": [{"backend": "ddgs", "outcome": "error"}],
            },
        )

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
        os.environ.pop("SEARCH_HELPER_FORCE_BROWSER", None)

    def test_ddgs_raises_uses_browser(self):
        calls = []
        out = search.run("q", 5, fake_factory(exc=RuntimeError("boom")), fake_browser(GOOD, calls=calls))
        self.assertEqual(
            out,
            {
                "results": GOOD,
                "backend": "browser",
                "attempts": [{"backend": "ddgs", "outcome": "error"}, {"backend": "browser", "outcome": "ok"}],
            },
        )
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
            out,
            {
                "error": "search_failed",
                "detail": "ddgs: RuntimeError: boom; browser: ValueError: nav",
                "attempts": [{"backend": "ddgs", "outcome": "error"}, {"backend": "browser", "outcome": "error"}],
            },
        )

    def test_browser_empty_is_search_failed(self):
        out = search.run("q", 5, fake_factory([]), fake_browser([]))
        self.assertEqual(
            out,
            {
                "error": "search_failed",
                "detail": "ddgs: no results; browser: no results",
                "attempts": [{"backend": "ddgs", "outcome": "empty"}, {"backend": "browser", "outcome": "empty"}],
            },
        )

    def test_env_fail_and_empty_route_to_browser(self):
        for mode, why in (("fail", "forced failure"), ("empty", "no results")):
            os.environ["SEARCH_HELPER_FORCE_DDGS"] = mode
            calls = []
            out = search.run("q", 5, fake_factory(HIT), fake_browser(GOOD, calls=calls))
            self.assertEqual(out["backend"], "browser", mode)
            self.assertEqual(len(calls), 1, mode)
            out = search.run("q", 5, fake_factory(HIT), fake_browser([]))
            self.assertEqual(out["detail"], f"ddgs: {why}; browser: no results")

    def test_force_browser_fail_both_fail(self):
        # When both FORCE_DDGS=fail and FORCE_BROWSER=fail, browser_search should never be called
        os.environ["SEARCH_HELPER_FORCE_DDGS"] = "fail"
        os.environ["SEARCH_HELPER_FORCE_BROWSER"] = "fail"
        calls = []
        out = search.run("q", 5, fake_factory(HIT), fake_browser(GOOD, calls=calls))
        self.assertEqual(out["error"], "search_failed")
        self.assertIn("browser: forced failure", out["detail"])
        self.assertEqual(calls, [])  # browser_search should never be called

    def test_force_browser_hang(self):
        # When FORCE_BROWSER=hang, launch is called, then sleep is called with >= 600s
        os.environ["SEARCH_HELPER_FORCE_BROWSER"] = "hang"
        sleep_calls = []

        def fake_sleep(duration):
            sleep_calls.append(duration)

        # Create a fake PW harness that tracks the launch call
        launch_called = [False]
        new_page_called = [False]

        class Page:
            def set_default_timeout(self, ms):
                pass

            def goto(self, *a, **k):
                pass

            def wait_for_url(self, pattern, **k):
                pass

            def wait_for_selector(self, selector, **k):
                pass

            def evaluate(self, script):
                return []

        class Ctx:
            def new_page(self):
                new_page_called[0] = True
                return Page()

        class Browser:
            def new_context(self, **k):
                return Ctx()

            def close(self):
                pass

        class PW:
            @staticmethod
            def launch(headless):
                launch_called[0] = True
                return Browser()

            chromium = type("C", (), {"launch": staticmethod(launch)})

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        # Replace the module's sleep function
        original_sleep = search._sleep
        try:
            search._sleep = fake_sleep
            search.browser_search("python", 5, sync_playwright=lambda: PW())
        finally:
            search._sleep = original_sleep

        # Verify that launch was called
        self.assertTrue(launch_called[0], "launch should be called")
        # Verify that sleep was called with >= 600s
        self.assertEqual(len(sleep_calls), 1, "sleep should be called exactly once")
        self.assertGreaterEqual(sleep_calls[0], 600, "sleep duration should be >= 600s")
        # Verify that new_page was called after sleep
        self.assertTrue(new_page_called[0], "new_page should still be called after sleep")

    def test_decode_bing_redirect(self):
        real = "https://en.wikipedia.org/wiki/Ada_Lovelace"
        token = "a1" + base64.urlsafe_b64encode(real.encode()).decode().rstrip("=")
        href = f"https://www.bing.com/ck/a?!&&p=abc&u={token}&ntb=1"
        self.assertEqual(search.decode_bing_href(href), real)
        self.assertEqual(search.decode_bing_href("https://example.org/x"), "https://example.org/x")
        self.assertIsNone(search.decode_bing_href("https://www.bing.com/ck/a?u=zzzz"))
        self.assertIsNone(search.decode_bing_href("https://www.bing.com/images/search?q=x"))
        self.assertIsNone(search.decode_bing_href("javascript:void(0)"))

    def test_decode_bing_keeps_microsoft_hosts(self):
        # Test direct Microsoft URLs are returned unchanged
        microsoft_urls = [
            "https://support.microsoft.com/en-us/excel/functions/vlookup-function",
            "https://learn.microsoft.com/en-us/azure/"
        ]
        for url in microsoft_urls:
            self.assertEqual(search.decode_bing_href(url), url)

        # Test wrapped Microsoft URLs decode back to the original
        for url in microsoft_urls:
            token = "a1" + base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")
            href = f"https://www.bing.com/ck/a?!&&p=abc&u={token}&ntb=1"
            self.assertEqual(search.decode_bing_href(href), url)

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

    def make_fake_pw_with_rows(self, evaluate_rows_per_call):
        """
        Factory to create a fake Playwright harness.
        evaluate_rows_per_call: list of lists of row dicts
                                Each element is a list of rows returned by one evaluate call
        Returns: (PW class, events list, goto_count list)
        """
        events = []
        goto_count = [0]
        evaluate_call_index = [0]

        class Page:
            def set_default_timeout(self, ms):
                pass

            def goto(self, *a, **k):
                goto_count[0] += 1

            def wait_for_url(self, pattern, **k):
                pass

            def wait_for_selector(self, selector, **k):
                pass

            def evaluate(self, script):
                idx = evaluate_call_index[0]
                evaluate_call_index[0] += 1
                if idx < len(evaluate_rows_per_call):
                    return evaluate_rows_per_call[idx]
                return []

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

        return PW, events, goto_count

    def test_scrape_duplicates_dropped(self):
        # Two rows with the same href should result in one result
        PW, events, goto_count = self.make_fake_pw_with_rows([
            [
                {"innerText": "Python", "textContent": "Python", "ariaLabel": "", "titleAttr": "", "href": "https://python.org", "snippet": "Official site"},
                {"innerText": "Python", "textContent": "Python", "ariaLabel": "", "titleAttr": "", "href": "https://python.org", "snippet": "Duplicate"},
            ]
        ])
        results = search.browser_search("python guide", 10, sync_playwright=lambda: PW())
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "https://python.org")
        self.assertEqual(events, ["browser closed", "playwright stopped"])

    def test_scrape_empty_title_row_dropped(self):
        # Row with all empty title fields should be dropped
        PW, events, goto_count = self.make_fake_pw_with_rows([
            [
                {"innerText": "", "textContent": "", "ariaLabel": "", "titleAttr": "", "href": "https://example.org", "snippet": "Snippet"},
                {"innerText": "Good Result", "textContent": "Good Result", "ariaLabel": "", "titleAttr": "", "href": "https://good.org", "snippet": "Useful"},
            ]
        ])
        results = search.browser_search("result guide", 10, sync_playwright=lambda: PW())
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "https://good.org")
        self.assertEqual(events, ["browser closed", "playwright stopped"])

    def test_scrape_bing_url_dropped(self):
        # Rows with bing.com URLs should be dropped
        PW, events, goto_count = self.make_fake_pw_with_rows([
            [
                {"innerText": "Bing Result", "textContent": "Bing Result", "ariaLabel": "", "titleAttr": "", "href": "https://www.bing.com/ck/a?u=a1aHR0cHM6Ly93d3cuYmluZy5jb20v&p=1", "snippet": ""},
                {"innerText": "Good Result", "textContent": "Good Result", "ariaLabel": "", "titleAttr": "", "href": "https://example.org", "snippet": "Useful"},
            ]
        ])
        results = search.browser_search("result guide", 10, sync_playwright=lambda: PW())
        # The bing.com URLs should decode to bing.com and be dropped
        # We expect only the good result
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "https://example.org")
        self.assertEqual(events, ["browser closed", "playwright stopped"])

    def test_scrape_results_capped_at_max_results(self):
        # 10 rows but max_results=3 should return only 3
        rows = [
            {"innerText": f"Result {i}", "textContent": f"Result {i}", "ariaLabel": "", "titleAttr": "", "href": f"https://example{i}.org", "snippet": "result"}
            for i in range(10)
        ]
        PW, events, goto_count = self.make_fake_pw_with_rows([rows])
        results = search.browser_search("result guide", 3, sync_playwright=lambda: PW())
        self.assertEqual(len(results), 3)
        self.assertEqual(results[0]["url"], "https://example0.org")
        self.assertEqual(results[1]["url"], "https://example1.org")
        self.assertEqual(results[2]["url"], "https://example2.org")
        self.assertEqual(events, ["browser closed", "playwright stopped"])

    def test_scrape_relevance_guard_two_gotos(self):
        # First page has no query words, second page does
        # Should call goto exactly twice
        PW, events, goto_count = self.make_fake_pw_with_rows([
            [
                {"innerText": "Unrelated", "textContent": "Unrelated", "ariaLabel": "", "titleAttr": "", "href": "https://unrelated.org", "snippet": "Not relevant"},
            ],
            [
                {"innerText": "Python Guide", "textContent": "Python Guide", "ariaLabel": "", "titleAttr": "", "href": "https://python.org", "snippet": "python tutorial"},
            ]
        ])
        results = search.browser_search("python guide", 10, sync_playwright=lambda: PW())
        self.assertEqual(goto_count[0], 2)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "https://python.org")
        self.assertEqual(events, ["browser closed", "playwright stopped"])

    def test_scrape_relevance_guard_one_goto(self):
        # First page already has query words
        # Should call goto exactly once
        PW, events, goto_count = self.make_fake_pw_with_rows([
            [
                {"innerText": "Python Guide", "textContent": "Python Guide", "ariaLabel": "", "titleAttr": "", "href": "https://python.org", "snippet": "python tutorial"},
            ]
        ])
        results = search.browser_search("python guide", 10, sync_playwright=lambda: PW())
        self.assertEqual(goto_count[0], 1)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "https://python.org")
        self.assertEqual(events, ["browser closed", "playwright stopped"])


class ClassifyTests(unittest.TestCase):
    def test_ratelimit_exception_class(self):
        class RatelimitException(Exception):
            pass

        self.assertEqual(search.classify_failure(RatelimitException("x")), "rate_limited")

    def test_rate_limit_texts(self):
        for text in ("HTTP 429", "Too Many Requests", "ratelimit hit", "Rate Limit exceeded"):
            self.assertEqual(search.classify_failure(RuntimeError(text)), "rate_limited", text)

    def test_captcha_texts(self):
        for text in ("CAPTCHA", "bot check", "Unusual Traffic", "Are you a robot?", "anomaly detected"):
            self.assertEqual(search.classify_failure(RuntimeError(text)), "captcha", text)

    def test_other_is_error(self):
        self.assertEqual(search.classify_failure(RuntimeError("boom")), "error")
        self.assertEqual(search.classify_failure(TimeoutError("timed out")), "error")

    def test_challenge_text(self):
        self.assertTrue(search.is_challenge_text("Our systems have detected unusual traffic"))
        self.assertTrue(search.is_challenge_text("Please solve the CAPTCHA"))
        self.assertFalse(search.is_challenge_text("python - Bing"))
        self.assertFalse(search.is_challenge_text(""))


def per_engine_factory(behaviours, calls, timeouts=None):
    """behaviours: engine -> hits list or an exception to raise."""

    def factory(timeout=None):
        if timeouts is not None:
            timeouts.append(timeout)

        class FakeDDGS:
            def text(self, query, **kwargs):
                calls.append(kwargs.get("backend"))
                b = behaviours[kwargs["backend"]]
                if isinstance(b, Exception):
                    raise b
                return b

        return FakeDDGS()

    return factory


class BackendsTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("SEARCH_HELPER_FORCE_DDGS", None)
        os.environ.pop("SEARCH_HELPER_FORCE_BROWSER", None)

    def test_stops_at_first_engine_with_results(self):
        calls, timeouts = [], []
        f = per_engine_factory({"bing": HIT, "brave": HIT}, calls, timeouts)
        out = search.run("q", 5, f, fake_browser(GOOD), backends=["bing", "brave"])
        self.assertEqual(calls, ["bing"])
        self.assertEqual(timeouts, [4])
        self.assertEqual(out["backend"], "bing")
        self.assertEqual(out["attempts"], [{"backend": "bing", "outcome": "ok"}])

    def test_failures_are_attributed_per_engine_then_browser(self):
        calls = []
        f = per_engine_factory(
            {
                "bing": RuntimeError("HTTP 429 Too Many Requests"),
                "brave": RuntimeError("captcha required"),
                "duckduckgo": [],
                "yahoo": RuntimeError("boom"),
            },
            calls,
        )
        out = search.run("q", 5, f, fake_browser(GOOD), backends=["bing", "brave", "duckduckgo", "yahoo"])
        self.assertEqual(calls, ["bing", "brave", "duckduckgo", "yahoo"])
        self.assertEqual(out["backend"], "browser")
        self.assertEqual(
            out["attempts"],
            [
                {"backend": "bing", "outcome": "rate_limited"},
                {"backend": "brave", "outcome": "captcha"},
                {"backend": "duckduckgo", "outcome": "empty"},
                {"backend": "yahoo", "outcome": "error"},
                {"backend": "browser", "outcome": "ok"},
            ],
        )

    def test_later_engine_succeeds_after_rate_limit(self):
        calls = []
        f = per_engine_factory({"bing": RuntimeError("429"), "brave": HIT}, calls)
        out = search.run("q", 5, f, None, backends=["bing", "brave"])
        self.assertEqual(out["backend"], "brave")
        self.assertEqual(
            out["attempts"],
            [{"backend": "bing", "outcome": "rate_limited"}, {"backend": "brave", "outcome": "ok"}],
        )

    def test_region_and_max_passed_per_engine(self):
        seen = []

        def factory(timeout=None):
            class F:
                def text(self, query, **kw):
                    seen.append(kw)
                    return []

            return F()

        search.run("q", 3, factory, None, backends=["bing"])
        self.assertEqual(
            seen, [{"region": "uk-en", "safesearch": "moderate", "max_results": 3, "backend": "bing"}]
        )

    def test_empty_backends_goes_straight_to_browser(self):
        calls, bcalls = [], []
        f = per_engine_factory({}, calls)
        out = search.run("q", 5, f, fake_browser(GOOD, calls=bcalls), backends=[])
        self.assertEqual(calls, [])
        self.assertEqual(len(bcalls), 1)
        self.assertEqual(out["attempts"], [{"backend": "browser", "outcome": "ok"}])

    def test_no_browser_skips_browser_and_all_failing_is_error(self):
        calls, bcalls = [], []
        f = per_engine_factory({"bing": RuntimeError("429"), "brave": RuntimeError("boom")}, calls)
        out = search.run("q", 5, f, fake_browser(GOOD, calls=bcalls), backends=["bing", "brave"], use_browser=False)
        self.assertEqual(bcalls, [])
        self.assertEqual(out["error"], "search_failed")
        self.assertEqual(
            out["attempts"],
            [{"backend": "bing", "outcome": "rate_limited"}, {"backend": "brave", "outcome": "error"}],
        )

    def test_nothing_tried_is_error_with_empty_attempts(self):
        out = search.run("q", 5, None, fake_browser(GOOD), backends=[], use_browser=False)
        self.assertEqual(out["error"], "search_failed")
        self.assertEqual(out["attempts"], [])

    def test_browser_captcha_exception_classified(self):
        out = search.run(
            "q", 5, fake_factory([]), fake_browser(exc=search.ChallengeError("captcha: x")), backends=[]
        )
        self.assertEqual(out["attempts"], [{"backend": "browser", "outcome": "captcha"}])
        self.assertEqual(out["error"], "search_failed")

    def test_force_hooks(self):
        for mode, outcome in (("ratelimit", "rate_limited"), ("captcha", "captcha")):
            os.environ["SEARCH_HELPER_FORCE_DDGS"] = mode
            calls = []
            out = search.run("q", 5, per_engine_factory({"bing": HIT}, calls), None, backends=["bing"])
            self.assertEqual(calls, [])
            self.assertEqual(out["attempts"], [{"backend": "bing", "outcome": outcome}])
        os.environ.pop("SEARCH_HELPER_FORCE_DDGS")
        os.environ["SEARCH_HELPER_FORCE_BROWSER"] = "captcha"
        bcalls = []
        out = search.run("q", 5, None, fake_browser(GOOD, calls=bcalls), backends=[])
        self.assertEqual(bcalls, [])
        self.assertEqual(out["attempts"], [{"backend": "browser", "outcome": "captcha"}])

    def test_browser_scrape_challenge_page_raises(self):
        class Page:
            def set_default_timeout(self, ms):
                pass

            def goto(self, *a, **k):
                pass

            def wait_for_url(self, *a, **k):
                pass

            def wait_for_selector(self, *a, **k):
                pass

            def evaluate(self, script):
                return "" if "li.b_algo" in script else "Verify - unusual traffic detected"

        class Ctx:
            def new_page(self):
                return Page()

        class Browser:
            def new_context(self, **k):
                return Ctx()

            def close(self):
                pass

        class PW:
            chromium = type("C", (), {"launch": staticmethod(lambda headless: Browser())})

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        # rows script returns "" (falsy) -> challenge probe runs and sees the marker
        with self.assertRaises(search.ChallengeError):
            search.browser_search("python", 5, sync_playwright=lambda: PW())


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

    def test_backends_empty_and_no_browser_reports_attempts(self):
        out = self.run_cli("--query", "x", "--backends", "", "--no-browser")
        self.assertEqual(out["error"], "search_failed")
        self.assertEqual(out["attempts"], [])

    def test_backends_forced_ratelimit(self):
        env = dict(os.environ, SEARCH_HELPER_FORCE_DDGS="ratelimit")
        p = subprocess.run(
            [sys.executable, str(SCRIPT), "--query", "x", "--backends", "bing,brave", "--no-browser"],
            capture_output=True, text=True, env=env,
        )
        out = json.loads(p.stdout)
        self.assertEqual(
            out["attempts"],
            [{"backend": "bing", "outcome": "rate_limited"}, {"backend": "brave", "outcome": "rate_limited"}],
        )

    def test_bad_max(self):
        self.assertEqual(self.run_cli("--query", "x", "--max", "abc")["error"], "bad_request")


if __name__ == "__main__":
    unittest.main()
