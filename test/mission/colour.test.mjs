// P3-5: light and dark readability, from the colour tokens in mission-app.css.
// WCAG 2 contrast for text, state marks, the focus ring and the map strokes;
// colour-vision simulation (Machado, Oliveira and Fernandes 2009, severity
// 1.0, applied in linear RGB) and CIEDE2000 differences between the seven map
// colours. No dependency.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m } = await H.setup();
const CSS = fs.readFileSync(path.join(H.REPO, "admin/mission-app.css"), "utf8");
const MAP = ["dead", "weekly", "monthly", "answered", "sent", "locked", "none"];

function tokens(css) {
  const block = (re) => {
    const mm = css.match(re);
    assert.ok(mm, "token block " + re);
    return Object.fromEntries([...mm[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((x) => [x[1], x[2].toLowerCase()]));
  };
  return {
    light: block(/^:root \{([^}]*)\}/m),
    "dark (prefers-color-scheme)": block(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/),
    "dark (data-theme)": block(/^:root\[data-theme="dark"\] \{([^}]*)\}/m),
  };
}
const THEMES = tokens(CSS);

// ── WCAG 2 relative luminance and contrast ──────────────────────────────────
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = (hex) => { const c = rgb(hex).map(lin); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ── colour-vision simulation and CIEDE2000 ──────────────────────────────────
const MACHADO = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
function simulate(hex, type) {
  const c = rgb(hex).map(lin);
  if (type === "normal") return c;
  return MACHADO[type].map((r) => Math.min(1, Math.max(0, r[0] * c[0] + r[1] * c[1] + r[2] * c[2])));
}
function lab([r, g, b]) {
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function de2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (b, a) => { if (a === 0 && b === 0) return 0; const h = Math.atan2(b, a) * deg; return h < 0 ? h + 360 : h; };
  const h1p = hp(b1, a1p), h2p = hp(b2, a2p);
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dLp = L2 - L1, dCp = C2p - C1p, dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
  const dTh = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTh * rad) * RC;
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}

test("P3-5 the colour maths match published reference values", () => {
  // Sharma, Wu and Dalal (2005) CIEDE2000 test data, pairs 1, 7 and 17
  assert.equal(de2000([50, 2.6772, -79.7751], [50, 0, -82.7485]).toFixed(4), "2.0425");
  assert.equal(de2000([50, 0, 0], [50, -1, 2]).toFixed(4), "2.3669");
  assert.equal(de2000([50, 2.5, 0], [73, 25, -18]).toFixed(4), "27.1492");
  assert.equal(ratio("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(ratio("#777777", "#ffffff").toFixed(2), "4.48");
});

test("P3-5 the dark tokens are the same under prefers-color-scheme and data-theme; data-theme=light wins over a dark device", () => {
  assert.deepEqual(THEMES["dark (prefers-color-scheme)"], THEMES["dark (data-theme)"]);
  assert.ok(CSS.includes(':root:not([data-theme="light"])'));
  for (const t of Object.values(THEMES)) for (const k of [...MAP.map((c) => "m-" + c), "m-stroke", "paper", "box", "ink"]) assert.ok(t[k], k);
});

test("P3-5 contrast: text, large text, state marks, focus ring and map strokes, light and dark", () => {
  // where each is used: text and marks on the page (paper) and in the glance box and the town sheet (box)
  const SURF = ["paper", "box"];
  const TEXT = ["ink", "muted", "accent", "ok", "watch", "act", "grey"];
  const MARKS = ["ok", "watch", "act", "grey"];
  const rows = [];
  for (const [theme, t] of Object.entries(THEMES)) {
    const check = (what, fg, bg, min) => {
      const r = ratio(t[fg], t[bg]);
      rows.push(theme + ": " + what + " " + fg + " on " + bg + " " + r.toFixed(2));
      assert.ok(r >= min, theme + " " + what + " " + fg + " on " + bg + " is " + r.toFixed(2) + " < " + min);
    };
    for (const s of SURF) {
      for (const x of TEXT) check("text", x, s, 4.5);
      check("large text (headline)", "ink", s, 3);
      for (const x of MARKS) check("state mark", x, s, 3);
      check("focus ring", "accent", s, 3);
    }
    for (const c of MAP) check("map stroke", "m-stroke", "m-" + c, 3);
    check("planned outline", "ink", "m-none", 3);
  }
  console.log("contrast\n  " + rows.join("\n  "));
});

test("P3-5 map colours under protanopia, deuteranopia and tritanopia: any pair under 10 carries a hatch", () => {
  const HATCHED = m.view.HATCHED;
  assert.deepEqual(HATCHED, ["dead"]);
  const lines = [];
  for (const [theme, t] of Object.entries(THEMES)) {
    if (theme === "dark (data-theme)") continue; // identical to the media-query tokens (checked above)
    for (const type of ["normal", "protanopia", "deuteranopia", "tritanopia"]) {
      let min = { de: Infinity };
      for (let i = 0; i < MAP.length; i++) {
        for (let j = i + 1; j < MAP.length; j++) {
          const de = de2000(lab(simulate(t["m-" + MAP[i]], type)), lab(simulate(t["m-" + MAP[j]], type)));
          if (de < min.de) min = { de, a: MAP[i], b: MAP[j] };
          if (de < 10) assert.ok(HATCHED.includes(MAP[i]) || HATCHED.includes(MAP[j]),
            theme + " " + type + ": " + MAP[i] + "/" + MAP[j] + " is " + de.toFixed(1) + " with no non-colour cue");
        }
      }
      lines.push(theme.split(" ")[0] + " " + type + ": smallest " + min.de.toFixed(1) + " (" + min.a + "/" + min.b + ")");
    }
  }
  console.log("CIEDE2000\n  " + lines.join("\n  "));
  // the hatch is drawn on the map and repeated on the legend and list swatches
  assert.match(CSS, /\.sw\.hatched \{ background-image: repeating-linear-gradient\(/);
  assert.match(CSS, /\.hatch-line \{ stroke: var\(--m-stroke\)/);
});
