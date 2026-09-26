// A small YAML parser for the rehearsal's workflow tests (Node built-ins
// only, no dependency). It reads the subset GitHub workflow files use: block
// mappings and sequences, "- key: value" items, flow sequences and mappings,
// quoted and plain scalars, "|" block scalars, comments. Anything outside that
// subset THROWS (tabs in indentation, a bad indent, a duplicate key, a plain
// scalar holding ": "), so a file that parses here is well-formed YAML of the
// shape a workflow needs. Keys stay strings ("on" is not a boolean).

export function parseYaml(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n").map((raw, k) => ({ raw, n: k + 1 }));
  let i = 0;
  const fail = (msg) => { throw new Error(`yaml: ${msg} (line ${i < lines.length ? lines[i].n : "end"})`); };
  const stripComment = (s) => {
    let q = null;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (q) { if (c === "\\" && q === '"') k++; else if (c === q) q = null; }
      else if ((c === '"' || c === "'") && (k === 0 || /[\s\[{,:]/.test(s[k - 1]))) q = c;
      else if (c === "#" && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k);
    }
    return s;
  };
  const indentOf = (s) => s.match(/^ */)[0].length;
  const blank = (s) => stripComment(s).trim() === "";
  const skipBlank = () => { while (i < lines.length && blank(lines[i].raw)) i++; };
  const KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s:#{}\[\],"'][^:#{}\[\],]*?)\s*:(?:\s+(.*))?$/;

  function parseBlock(indent) {
    skipBlank();
    if (i >= lines.length) return null;
    const l = lines[i].raw;
    if (/^ *\t/.test(l)) fail("tab in indentation");
    const ind = indentOf(l);
    if (ind < indent) return null;
    const t = stripComment(l).trim();
    return t === "-" || t.startsWith("- ") ? parseSeq(ind) : parseMap(ind);
  }
  function parseMap(ind) {
    const obj = {};
    for (;;) {
      skipBlank();
      if (i >= lines.length) break;
      const l = lines[i].raw;
      if (/^ *\t/.test(l)) fail("tab in indentation");
      const li = indentOf(l);
      if (li < ind) break;
      if (li > ind) fail("unexpected indent");
      const t = stripComment(l).trim();
      if (t === "-" || t.startsWith("- ")) break;
      const m = t.match(KEY);
      if (!m) fail("not a key: value line");
      const key = unquote(m[1].trim());
      if (Object.prototype.hasOwnProperty.call(obj, key)) fail(`duplicate key ${key}`);
      const rest = m[2] === undefined ? "" : m[2].trim();
      i++;
      if (rest === "") {
        skipBlank();
        if (i < lines.length) {
          const ni = indentOf(lines[i].raw);
          const nt = stripComment(lines[i].raw).trim();
          obj[key] = ni > ind || (ni === ind && (nt === "-" || nt.startsWith("- "))) ? parseBlock(ni) : null;
        } else obj[key] = null;
      } else if (/^[|>][-+]?$/.test(rest)) obj[key] = blockScalar(ind, rest);
      else obj[key] = inline(rest);
    }
    return obj;
  }
  function parseSeq(ind) {
    const arr = [];
    for (;;) {
      skipBlank();
      if (i >= lines.length) break;
      const l = lines[i].raw;
      const li = indentOf(l);
      if (li < ind) break;
      if (li > ind) fail("unexpected indent in sequence");
      const t = stripComment(l).trim();
      if (!(t === "-" || t.startsWith("- "))) break;
      const rest = t === "-" ? "" : t.slice(2).trim();
      if (rest === "") { i++; arr.push(parseBlock(ind + 1)); continue; }
      if (!/^[\[{"']/.test(rest) && KEY.test(rest)) {
        // "- key: value": a mapping whose keys sit at ind + 2
        const raw = lines[i].raw;
        lines[i] = { raw: " ".repeat(ind + 2) + raw.slice(raw.indexOf("-") + 1).replace(/^ +/, ""), n: lines[i].n };
        arr.push(parseMap(ind + 2));
      } else { i++; arr.push(inline(rest)); }
    }
    return arr;
  }
  function blockScalar(ind, style) {
    const out = [];
    let content = null;
    while (i < lines.length) {
      const raw = lines[i].raw;
      if (raw.trim() === "") { out.push(""); i++; continue; }
      const li = indentOf(raw);
      if (li <= ind) break;
      if (content === null) content = li;
      if (li < content) fail("block scalar indent");
      out.push(raw.slice(content));
      i++;
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    const body = style.startsWith(">") ? out.join(" ") : out.join("\n");
    return style.endsWith("-") ? body : body + "\n";
  }
  function inline(s) {
    const p = { s, k: 0 };
    const v = flowValue(p, false);
    p.k = skipWs(p.s, p.k);
    if (p.k !== p.s.length) fail("trailing text after a value");
    return v;
  }
  function skipWs(s, k) { while (k < s.length && /\s/.test(s[k])) k++; return k; }
  function flowValue(p, inFlow) {
    p.k = skipWs(p.s, p.k);
    const c = p.s[p.k];
    if (c === "[") {
      p.k++;
      const arr = [];
      for (;;) {
        p.k = skipWs(p.s, p.k);
        if (p.s[p.k] === "]") { p.k++; return arr; }
        arr.push(flowValue(p, true));
        p.k = skipWs(p.s, p.k);
        if (p.s[p.k] === ",") { p.k++; continue; }
        if (p.s[p.k] === "]") { p.k++; return arr; }
        fail("bad flow sequence");
      }
    }
    if (c === "{") {
      p.k++;
      const obj = {};
      for (;;) {
        p.k = skipWs(p.s, p.k);
        if (p.s[p.k] === "}") { p.k++; return obj; }
        const key = String(flowValue(p, true));
        p.k = skipWs(p.s, p.k);
        if (p.s[p.k] !== ":") fail("bad flow mapping");
        p.k++;
        obj[key] = flowValue(p, true);
        p.k = skipWs(p.s, p.k);
        if (p.s[p.k] === ",") { p.k++; continue; }
        if (p.s[p.k] === "}") { p.k++; return obj; }
        fail("bad flow mapping");
      }
    }
    if (c === '"' || c === "'") {
      let k = p.k + 1, out = "";
      for (; k < p.s.length; k++) {
        const ch = p.s[k];
        if (c === '"' && ch === "\\") { const e = p.s[++k]; out += e === "n" ? "\n" : e === "t" ? "\t" : e; continue; }
        if (ch === c) { if (c === "'" && p.s[k + 1] === "'") { out += "'"; k++; continue; } break; }
        out += ch;
      }
      if (k >= p.s.length) fail("unterminated quote");
      p.k = k + 1;
      return out;
    }
    let k = p.k;
    while (k < p.s.length && !(inFlow && /[,\]}:]/.test(p.s[k]))) k++;
    const raw = p.s.slice(p.k, k).trim();
    p.k = k;
    if (/:\s/.test(raw) || /:$/.test(raw)) fail("plain scalar holds \": \"");
    return scalar(raw);
  }
  function scalar(raw) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null" || raw === "~" || raw === "") return null;
    if (/^-?\d+$/.test(raw)) return Number(raw);
    return raw;
  }
  function unquote(k) {
    if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) return inline(k);
    return k;
  }
  const doc = parseBlock(0);
  skipBlank();
  if (i < lines.length) fail("content after the document");
  return doc;
}
