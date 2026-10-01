# Manual inputs: engine contract

This is what the private engine may rely on when it reads hand-delivered files.
The website side (this repo) writes the files; the engine only reads them,
through one route, from inside the existing refresh job. No workflow change is
needed (see "Getting a token" below), so there is no PROPOSED_YML_CHANGE.txt.

## Where the files live

Private R2 bucket, the same one the Pages project binds as `BUNDLES`. Only keys
under `manual-raw/` are used:

| Key | What it is |
|---|---|
| `manual-raw/index.json` | the append-only index of every file received |
| `manual-raw/<slug>/<yyyymmddTHHMMSSZ>-<sha12>.<ext>` | one received file, raw bytes, never replaced |

* `<slug>`: 2 to 40 characters of `a-z`, `0-9` and `-`, starting with a letter
  or digit. The set of slugs is configuration (`MANUAL_SOURCES` on the Pages
  project), never code.
* `<yyyymmddTHHMMSSZ>`: the UTC time the file was received, for example
  `20260921T140309Z`.
* `<sha12>`: the first 12 lowercase hex characters of the file's SHA-256.
* `<ext>`: `csv`, `xlsx` or `pdf`, decided from the file's content, never
  from its name.

The one pattern both sides use (JavaScript `KEY_RX` in
`functions/api/_manual_store.js`; the same text works in Python `re`):

```
^manual-raw/(?:index\.json|[a-z0-9][a-z0-9-]{1,39}/20\d\d(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3])[0-5]\d[0-5]\dZ-[0-9a-f]{12}\.(?:csv|xlsx|pdf))$
```

## The index

```json
{
  "schema": 1,
  "entries": [
    {
      "key": "manual-raw/town-a/20260921T140309Z-3f1c0a9b7d22.csv",
      "slug": "town-a",
      "sha256": "3f1c0a9b7d22...64 hex in all",
      "bytes": 48213,
      "ext": "csv",
      "received_at": "2026-09-21T14:03:09.123Z",
      "via": "drop",
      "name": "sanitized original name.csv"
    }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `key` | string | the object key; always matches `KEY_RX` |
| `slug` | string | the source it was filed under |
| `sha256` | string | 64 lowercase hex of the raw bytes |
| `bytes` | integer | size of the raw bytes, at most 10 MB |
| `ext` | `csv` \| `xlsx` \| `pdf` | the type, from content |
| `received_at` | ISO 8601 UTC | when it arrived |
| `via` | `drop` \| `email` | owner drop box, or the email intake |
| `name` | string | original file name, no path, at most 80 characters, conservative characters only |

Guarantees:

* **Append-only.** Entries are only ever added, with a conditional write on the
  etag that was read, retried on conflict. Two writers can never lose an entry.
* **Immutable files.** A data key is written once and never replaced.
* **No duplicates per source.** The same bytes under the same slug are stored
  once; a second delivery answers "already received" and adds nothing.
* **Checked content.** Every file passed a content check before it was stored:
  a PDF starts with `%PDF-` and carries no `/Encrypt`, `/EmbeddedFile`,
  `/JavaScript`, `/Launch`, `/RichMedia` or `/XFA`; an xlsx is a zip with
  `[Content_Types].xml`, an `xl/` part and a plain spreadsheet main part, with
  no macros, no embedded objects, no nested archives and no encrypted entries;
  a csv is UTF-8 with a header row of at least two cells. The engine must still
  treat every file as untrusted input (see below).
* `schema` changes only if the shape changes. Refuse any other value.

The engine should order entries by `received_at`, and for each slug use the
newest entry (or every entry since its last successful use, if it keeps
state). `name` is for humans only; never branch on it.

## The read route

`GET https://masspermits.com/api/get-drop?key=<key>`

* **Auth:** `Authorization: Bearer <GitHub Actions OIDC token>`. The route
  verifies the RS256 signature against GitHub's JWKS and checks, exactly:
  `iss` is `https://token.actions.githubusercontent.com`; `aud` includes
  `masspermits-cron` (the audience `/api/get-engine` uses); `repository` is
  `capecodtaxappeal/masspermits-lander`; `ref` is `refs/heads/main`; `exp` is in
  the future; and `workflow_ref` is exactly
  `capecodtaxappeal/masspermits-lander/.github/workflows/weekly-refresh.yml@refs/heads/main`
  (so is `job_workflow_ref` when present). Any other workflow in this repo is
  refused, even on main.
* **Query:** exactly one parameter, `key`, whose value matches `KEY_RX`. Any
  other parameter, a second `key`, or any character outside `A-Z a-z 0-9 . _ - /`
  (or `%2F`) in the raw query is a 400. Encode `/` as `/` or `%2F`; nothing else
  needs encoding.
* **Answers:** 200 with the raw bytes (`Cache-Control: no-store`); 400 for a
  refused key; 401 for a refused token (`reason` is one word); 404 if the key
  does not exist; 405 for anything but GET; 413 if the object is over 25 MB.
* Read-only. There is no list call: the index is the only way to find keys.

## Getting a token inside the existing job

The job already grants the OIDC permission at workflow level, so every step,
and every process a step starts, gets `ACTIONS_ID_TOKEN_REQUEST_URL` and
`ACTIONS_ID_TOKEN_REQUEST_TOKEN` in its environment. From
`.github/workflows/weekly-refresh.yml` (trailing comments omitted):

```yaml
permissions:
  id-token: write
  contents: write
```

and the engine fetch step already mints with exactly this audience:

```yaml
            OIDC=$(curl -fsS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
              "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=masspermits-cron" | jq -r .value)
```

The engine runs inside that job (`python -u hosted_refresh.py` in the step
"Scrape, quality-gate, build bundles"), so it can mint its own token the same
way. No yml change is required. Tokens last about 5 minutes: mint one per
request, or at least once per minute.

## Example (Python pseudocode)

```python
import hashlib, json, os, pathlib, re, urllib.parse, urllib.request

KEY_RX = re.compile(r"^manual-raw/(?:index\.json|[a-z0-9][a-z0-9-]{1,39}/20\d\d(?:0[1-9]|1[0-2])"
                    r"(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3])[0-5]\d[0-5]\dZ-[0-9a-f]{12}\.(?:csv|xlsx|pdf))$")
BASE = "https://masspermits.com/api/get-drop?"
DEST = pathlib.Path(os.environ["RUNNER_TEMP"]) / "manual-raw"   # never under site/

def mint() -> str:
    url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=masspermits-cron"
    req = urllib.request.Request(url, headers={
        "Authorization": "bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["value"]

def get(key: str, cap: int = 25 * 1024 * 1024) -> bytes:
    if not KEY_RX.fullmatch(key):
        raise ValueError("bad key")
    req = urllib.request.Request(BASE + urllib.parse.urlencode({"key": key}),
                                 headers={"Authorization": "Bearer " + mint()})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read(cap + 1)
    if len(body) > cap:
        raise ValueError("too large")
    return body

def fetch_manual() -> dict:
    """Returns {slug: [local paths, oldest first]}. Prints counts only."""
    got, failed = {}, 0
    try:
        index = json.loads(get("manual-raw/index.json"))
    except Exception:
        print("manual inputs: index unavailable")      # no URL, no key, no slug
        return got
    if index.get("schema") != 1:
        print("manual inputs: unknown index schema")
        return got
    for e in sorted(index.get("entries", []), key=lambda e: e.get("received_at", "")):
        key = e.get("key", "")
        if not KEY_RX.fullmatch(key) or not key.startswith("manual-raw/" + e.get("slug", "") + "/"):
            failed += 1
            continue
        path = DEST / key[len("manual-raw/"):]
        try:
            if not path.exists():
                body = get(key)
                if hashlib.sha256(body).hexdigest() != e.get("sha256") or len(body) != e.get("bytes"):
                    raise ValueError("hash")
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
            got.setdefault(e["slug"], []).append(path)
        except Exception:
            failed += 1
    print(f"manual inputs: {sum(len(v) for v in got.values())} file(s), {failed} failed")
    return got
```

## Rules for the engine

1. **Never fail the run** because a manual input is missing or bad. Treat it
   like any other source that returned nothing this time.
2. **Write downloads under `$RUNNER_TEMP`**, never under `site/` (the clone
   that is committed and published) and never under the job's working tree
   root. `.gitignore` in this repo also ignores `manual-raw/`, as a second belt.
3. **Log counts only.** Actions logs on this public repo are public. Never
   print a key, a slug, a file name, a URL with a query, a cell value or an
   exception message that might contain one. Do not use `set -x` around these
   calls.
4. **Treat content as untrusted.** Open xlsx files read-only with formulas
   not evaluated and macros never run; extract PDF text only; read csv with a
   csv parser, not `eval`. Bound rows and columns. Verify `sha256` and `bytes`
   against the index before use.
5. **Read only.** The engine has no write path to `manual-raw/` and needs none.
