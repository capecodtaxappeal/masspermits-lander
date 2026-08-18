"""Map the files this build changed onto the URLs worth announcing.

Run by the IndexNow step of weekly-refresh.yml. Prints a JSON array of absolute
URLs on stdout, or `[]` when nothing publishable changed.

Two rules, both deliberate:

  * A URL is only announced if it is IN the sitemap this build just wrote.
    Otherwise the same run would tell a crawler "come look at this page" while
    the page itself carries `noindex` -- which is what would happen to the ~470
    cost pages, and to any page a guard dropped from the index.

  * If the changed-file list is missing or empty, the answer is `[]`, never
    "submit everything". Falling back to the whole sitemap is precisely the
    behaviour this replaced: a daily resubmission of every URL teaches the
    receiving engines that our signal carries no information.
"""
import json
import os
import re
import sys

SITE = "https://masspermits.com"
SITEMAP = "site/sitemap.xml"
CHANGED = os.path.join(os.environ.get("GITHUB_WORKSPACE", "."), "changed-paths.txt")


def url_for(path: str) -> str:
    """Repo-relative file path -> the URL Cloudflare Pages serves it at."""
    p = "/" + path[: -len(".html")]
    if p.endswith("/index"):
        p = p[: -len("index")]          # /research/index.html -> /research/
    elif p == "/index":
        p = "/"
    return SITE + p


def main() -> int:
    try:
        indexed = set(re.findall(r"<loc>([^<]+)</loc>",
                                 open(SITEMAP, encoding="utf-8").read()))
    except OSError as e:
        print("[]")
        print(f"::warning::IndexNow: cannot read {SITEMAP} ({e}) - submitting nothing",
              file=sys.stderr)
        return 0

    try:
        changed = [l.strip() for l in open(CHANGED, encoding="utf-8") if l.strip()]
    except OSError:
        changed = []

    out, skipped = [], 0
    for f in changed:
        if not f.endswith(".html"):
            continue
        u = url_for(f)
        if u in indexed:
            out.append(u)
        else:
            skipped += 1

    out = sorted(set(out))
    print(json.dumps(out))
    print(f"IndexNow: {len(changed)} files changed -> {len(out)} indexed URLs "
          f"({skipped} changed pages are not in the sitemap and were withheld)",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
