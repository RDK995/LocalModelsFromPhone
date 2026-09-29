"""Search helper (I17): ddgs text search, one JSON object on stdout, always exit 0."""
import argparse
import json
import sys

REGION = "uk-en"
MIN_MAX, MAX_MAX = 1, 10


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError(message)


def _default_factory():
    from ddgs import DDGS

    return DDGS()


def run(query, max_results, ddgs_factory=None):
    max_results = max(MIN_MAX, min(MAX_MAX, max_results))
    try:
        client = (ddgs_factory or _default_factory)()
        hits = client.text(query, region=REGION, safesearch="moderate", max_results=max_results)
        results = []
        for hit in hits or []:
            url = (hit.get("href") or "").strip()
            if not url:
                continue
            results.append({"title": hit.get("title") or "", "url": url, "snippet": hit.get("body") or ""})
        return {"results": results, "backend": "ddgs"}
    except Exception as e:  # noqa: BLE001 - contract: report, never raise
        return {"error": "search_failed", "detail": f"{type(e).__name__}: {e}"}


def main(argv=None):
    parser = _Parser(prog="search.py")
    parser.add_argument("--query", required=True)
    parser.add_argument("--max", type=int, default=5)
    try:
        args = parser.parse_args(argv)
        query = args.query.strip()
        if not query:
            raise ValueError("--query must not be empty")
        out = run(query, args.max)
    except ValueError as e:
        out = {"error": "bad_request", "detail": str(e)}
    sys.stdout.write(json.dumps(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
