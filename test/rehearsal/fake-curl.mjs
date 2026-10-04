// A stand-in for curl, used ONLY by scripts/rehearsal/workflow.test.mjs to
// run the caller job's script from monday-rehearsal.yml.txt with no network.
// A tiny "curl" shell wrapper on PATH execs this file.
//
// It knows the caller's two curl shapes:
//   mint:  curl -fsS -H "Authorization: bearer <req token>" "<request url>&audience=masspermits-cron"
//          -> prints {"value": "<a fresh OIDC token>"}
//   POST:  curl -sS -o resp.json -X POST -H "Authorization: Bearer <oidc>" -H ... --data-binary <facts> <url>
//          -> writes the response the test pre-recorded for (part, page) into resp.json
// Every call is appended to $FAKE_CURL_DIR/calls.jsonl. Responses come from
// $FAKE_CURL_DIR/responses.json ({"<part>:<page>": <body>}), recorded by the
// test from real in-process runs of rehearsal.js. Nothing is ever fetched.

import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.FAKE_CURL_DIR;
const args = process.argv.slice(2);
const headers = [];
let out = null, method = "GET", data = null, url = null;
for (let k = 0; k < args.length; k++) {
  const a = args[k];
  if (a === "-H") headers.push(args[++k]);
  else if (a === "-o") out = args[++k];
  else if (a === "-X") method = args[++k];
  else if (a === "--data-binary") data = args[++k];
  else if (a.startsWith("-")) continue;
  else url = a;
}
const counterFile = join(dir, "mint-count");
const record = { args, method, url, headers, out, data };
appendFileSync(join(dir, "calls.jsonl"), JSON.stringify(record) + "\n");

if (!out) {
  // mint
  const n = (existsSync(counterFile) ? Number(readFileSync(counterFile, "utf8")) : 0) + 1;
  writeFileSync(counterFile, String(n));
  if (!/audience=masspermits-cron$/.test(url || "")) { process.stderr.write("fake curl: bad mint url\n"); process.exit(22); }
  process.stdout.write(JSON.stringify({ value: `oidc-token-${n}-zzzzzzzzzzzzzzzzzzzz` }) + "\n");
} else {
  const u = new URL(url);
  const key = `${u.searchParams.get("part")}:${u.searchParams.get("page")}`;
  const table = JSON.parse(readFileSync(join(dir, "responses.json"), "utf8"));
  const body = table[key] || { ok: false, verdict: null, more: false, codes: [], error: "bad_param" };
  writeFileSync(join(process.cwd(), out), JSON.stringify(body));
}
