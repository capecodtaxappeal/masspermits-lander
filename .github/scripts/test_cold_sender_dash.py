"""Tests for cold_sender.py's send-time dash guard. Test-only; no workflow runs it.

    python -B .github/scripts/test_cold_sender_dash.py

Nothing here touches the network, R2 or SMTP: get_json, put_state, the SMTP
class, sleep and random are all replaced with in-memory fakes, and every
address is @example.com.
"""
import importlib.util
import os
import sys
import unittest
from unittest import mock

sys.dont_write_bytecode = True   # the repo tracks __pycache__/*.pyc; never rewrite it
HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("cold_sender", os.path.join(HERE, "cold_sender.py"))
cs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cs)

EM, EN = chr(0x2014), chr(0x2013)   # built from code points: this file stays dash-free
TOKENS = [EM, EN, "&mdash;", "&ndash;", "&#8212;", "&#8211;", "&#08212;", "&#x2014;",
          "&#X2013;", "\\u2014", "\\u2013"]


def has_dash(s):
    low = s.lower()
    return any(t.lower() in low for t in TOKENS)


class UndashText(unittest.TestCase):
    def check(self, src, want, n=None):
        got, count = cs._undash(src)
        self.assertEqual(got, want)
        self.assertFalse(has_dash(got))
        if n is not None:
            self.assertEqual(count, n)

    def test_every_token_form_is_removed(self):
        for tok in TOKENS:
            with self.subTest(tok=tok):
                got, n = cs._undash(f"Hi Sam {tok} I track permits.")
                self.assertEqual(got, "Hi Sam, I track permits.")
                self.assertEqual(n, 1)

    def test_mid_sentence_becomes_comma(self):
        self.check(f"Hi Sam {EM} quick one.", "Hi Sam, quick one.", 1)
        self.check(f"Hi Sam{EM}quick one.", "Hi Sam, quick one.", 1)

    def test_empty_name_opener(self):
        # "Hi{name} ..." with an empty name
        self.check(f"Hi {EM} I track every building permit.", "Hi, I track every building permit.")

    def test_numeric_range_keeps_a_hyphen(self):
        self.check(f"weekdays 9{EN}5, 2025{EN}2026", "weekdays 9-5, 2025-2026", 2)
        self.check(f"2025 {EN} 2026", "2025-2026")

    def test_line_start_and_line_end(self):
        self.check(f"does\n{EM} and they usually", "does\nand they usually")
        self.check(f"I'll email the sheet {EM}\nfree, no card.", "I'll email the sheet,\nfree, no card.")

    def test_next_to_punctuation_leaves_no_artifact(self):
        self.check(f"permits, {EM} fresh", "permits, fresh")
        self.check(f"permits {EM}.", "permits.")
        self.check(f"(names {EM} masked)", "(names, masked)")
        self.check(f"({EM} masked)", "(masked)")
        got, _ = cs._undash(f"a, {EM}, b {EM} , c")
        self.assertNotRegex(got, r",\s*,")

    def test_clean_text_is_untouched(self):
        s = "Hi Sam, I track every building permit in Exampleton.\n\n- Pat"
        self.assertEqual(cs._undash(s), (s, 0))

    def test_non_string_passes_through(self):
        for v in (None, 5, b"x \xe2\x80\x94 y", ["a"]):
            self.assertEqual(cs._undash(v), (v, 0))
        self.assertEqual(cs._undash(""), ("", 0))

    def test_never_raises(self):
        class Broken:
            def subn(self, *a, **k):
                raise RuntimeError("boom")
        with mock.patch.object(cs, "_DASH_RE", Broken()):
            self.assertEqual(cs._undash(f"a {EM} b"), (f"a {EM} b", 0))
        with mock.patch.object(cs, "_DASH_RE", None):
            self.assertEqual(cs._undash(f"a {EM} b"), (f"a {EM} b", 0))

    def test_the_sender_file_itself_has_no_dash(self):
        with open(os.path.join(HERE, "cold_sender.py"), encoding="utf-8") as f:
            src = f.read()
        self.assertNotIn(EM, src)
        self.assertNotIn(EN, src)


class FakeSMTP:
    sent = []

    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def starttls(self, **k): pass
    def login(self, *a): pass
    def send_message(self, msg): FakeSMTP.sent.append(msg)


class MainLoop(unittest.TestCase):
    """main() sends the cleaned text, and dedupe/checkpoint behaviour is unchanged."""

    def run_main(self, queue, broken_guard=False):
        FakeSMTP.sent = []
        checkpoints = []
        store = {"cold-state.json": {"ramp_start": "2000-01-01", "log": []},
                 "cold-queue.json": queue, "suppression.json": []}
        patches = [
            mock.patch.object(cs, "SMTP_PASS", "x"),
            mock.patch.object(cs, "DRYRUN", False),
            mock.patch.dict(os.environ, {"TEST_RECIPIENT": ""}),
            mock.patch.object(cs, "get_json", lambda k: store[k]),
            mock.patch.object(cs, "put_state", lambda s: checkpoints.append(len(s.get("log", [])))),
            mock.patch.object(cs.smtplib, "SMTP", FakeSMTP),
            mock.patch.object(cs.time, "sleep", lambda *_: None),
        ]
        if broken_guard:
            patches.append(mock.patch.object(cs, "_DASH_RE", object()))  # .subn missing -> fault
        for p in patches:
            p.start()
        try:
            with mock.patch("builtins.print"):
                cs.main()
        finally:
            for p in reversed(patches):
                p.stop()
        return FakeSMTP.sent, checkpoints

    QUEUE = [
        {"to": "a@example.com", "subject": f"Exampleton permits {EM} worth a look?",
         "body": f"Hi Al {EM} I track permits.\n\nI'll email the sheet {EM}\nfree, no card.", "batch": "T"},
        {"to": "b@example.com", "subject": "No dash here", "body": "Clean body.", "batch": "T"},
        {"to": "c@example.com", "subject": "Hi &mdash; there", "body": "x &#8212; y", "batch": "T"},
    ]

    def test_sends_clean_subject_and_body(self):
        sent, checkpoints = self.run_main([dict(e) for e in self.QUEUE])
        self.assertEqual(len(sent), 3)
        self.assertEqual(checkpoints, [1, 2, 3])          # one checkpoint AFTER each send
        for m in sent:
            self.assertFalse(has_dash(m["Subject"]))
            self.assertFalse(has_dash(m.get_content()))
        self.assertEqual(sent[0]["Subject"], "Exampleton permits, worth a look?")
        self.assertEqual([m["To"] for m in sent], ["a@example.com", "b@example.com", "c@example.com"])

    def test_guard_fault_never_blocks_or_double_sends(self):
        sent, checkpoints = self.run_main([dict(e) for e in self.QUEUE], broken_guard=True)
        self.assertEqual(len(sent), 3)
        self.assertEqual(checkpoints, [1, 2, 3])


if __name__ == "__main__":
    unittest.main(verbosity=2)
