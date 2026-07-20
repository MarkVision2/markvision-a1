# -*- coding: utf-8 -*-
"""Strip / normalize motion inserts that dump speech as huge on-screen text.

Karaoke captions already show what the speaker says. AI often sends
big-statement with data.text (full phrase) while Remotion expected data.lines —
which used to fall back to the demo placeholder «БОЛЬШОЕ / ЗАЯВЛЕНИЕ».

Usage: python pipeline/inserts_sanitize.py <work_dir>
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# Templates that only re-print the spoken line — karaoke already covers this.
ECHO_TEMPLATES = frozenset({
    "big-statement",
    "kinetic-type",
    "quote-card",
})

MAX_PUNCH_WORDS = 3


def _words(s: str) -> list[str]:
    return [w for w in re.split(r"\s+", (s or "").strip()) if w]


def _punch_lines(text: str, max_words: int = MAX_PUNCH_WORDS) -> list[str]:
    ws = _words(text)
    if not ws:
        return []
    # Keep a short punch, not the whole sentence.
    chunk = ws[:max_words]
    return [" ".join(chunk)]


def _has_visual_payload(data: dict, template: str) -> bool:
    if not isinstance(data, dict):
        return False
    if template == "checklist-reveal" and data.get("items"):
        return True
    if template == "timeline-steps" and (data.get("steps") or data.get("items")):
        return True
    if template in ("metric-callout", "number-counter", "gauge", "countdown") and (
        data.get("value") is not None or data.get("from") is not None
    ):
        return True
    if template in ("vs-compare", "fake-dashboard-bars") and (
        data.get("bars") or data.get("leftItems") or data.get("rightItems")
    ):
        return True
    if template == "pill-row" and data.get("items"):
        return True
    if template == "notification-toast" and (data.get("title") or data.get("text")):
        # toast ok if short
        t = str(data.get("text") or "")
        return len(_words(t)) <= 6
    return False


def sanitize_insert(it: dict) -> dict | None:
    if not isinstance(it, dict):
        return None
    # File / video b-roll — keep as-is.
    if it.get("file") and not it.get("template"):
        return it

    template = str(it.get("template") or "").strip()
    if not template:
        return it

    data = dict(it.get("data") or {})
    spoken = str(it.get("spokenText") or it.get("note") or data.get("spokenText") or "").strip()
    text = str(data.get("text") or "").strip()
    lines = data.get("lines")
    if isinstance(lines, str):
        lines = [lines]
    if not isinstance(lines, list):
        lines = []
    lines = [str(x).strip() for x in lines if str(x).strip()]

    # Map text → lines for big-statement / quote-card.
    if template in ("big-statement", "quote-card") and not lines and text:
        lines = _punch_lines(text)
        data["lines"] = lines
        data.pop("text", None)

    if template == "kinetic-type":
        words = data.get("words")
        if not isinstance(words, list) or not words:
            src = text or spoken
            words = _words(src)[:MAX_PUNCH_WORDS]
            if not words:
                return None
            data["words"] = words
            data.pop("text", None)

    if template in ECHO_TEMPLATES:
        # Drop speech-echo overlays: karaoke already shows the line.
        # Keep only if there is a short punch (≤3 words) that is NOT the full spoken sentence.
        payload = " ".join(lines) if lines else " ".join(data.get("words") or [])
        pw = _words(payload)
        sw = _words(spoken)
        if not pw:
            return None
        if len(pw) > MAX_PUNCH_WORDS:
            return None
        if sw and " ".join(pw).lower() == " ".join(sw).lower():
            return None
        if sw and len(sw) > MAX_PUNCH_WORDS and " ".join(pw).lower() in " ".join(sw).lower():
            # still just a quote fragment of the same line under karaoke — drop
            return None
        data["lines"] = lines[:2] if lines else data.get("lines")
        return {**it, "data": data, "layout": it.get("layout") or "third"}

    # Shorten long toast / label text that dumps the whole phrase.
    for key in ("text", "label", "title", "caption"):
        if key in data and isinstance(data[key], str) and len(_words(data[key])) > 8:
            data[key] = " ".join(_words(data[key])[:5])

    if not _has_visual_payload(data, template) and template in {
        "notification-toast", "countdown", "gauge", "loading-to-done",
    }:
        # toast/countdown without real payload often just reprints speech — drop
        if text and len(_words(text)) > 4 and not data.get("value") and data.get("from") is None:
            return None

    return {**it, "data": data}


def sanitize(work: Path) -> dict:
    path = work / "inserts.json"
    if not path.exists():
        return {"inserts": []}
    doc = json.loads(path.read_text(encoding="utf-8"))
    raw = list(doc.get("inserts") or [])
    out: list[dict] = []
    dropped = 0
    for it in raw:
        cleaned = sanitize_insert(it)
        if cleaned is None:
            dropped += 1
            continue
        out.append(cleaned)
    doc = {"inserts": out}
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK inserts_sanitize kept={len(out)} dropped={dropped} (was {len(raw)})")
    return doc


if __name__ == "__main__":
    sanitize(Path(sys.argv[1]))
