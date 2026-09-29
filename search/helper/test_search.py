import json
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
