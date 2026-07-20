# -*- coding: utf-8 -*-
"""Densify motion inserts — fill timeline gaps with semantic top overlays.

Usage: python pipeline/inserts_enrich.py <work_dir> [gap_sec=4.5]
Reads words.json + optional inserts.json, writes inserts.json back (merged).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ACCENTS = ["#FF7A18", "#22D3EE", "#8B5CF6", "#34D399", "#FFC53D", "#FB7185", "#38BDF8"]

RULES: list[tuple[re.Pattern[str], str, dict]] = [
    (re.compile(r"\b(врем[яе]|час|минут|секунд|дедлайн|успе|опозд|тороп|скоро)\b", re.I),
     "countdown", {"from": 5, "label": "Время", "icon": "clock"}),
    (re.compile(r"\b(деньг|₸|тенге|доход|прибыл|выручк|цена|стоим|рубл|доллар)\b", re.I),
     "number-counter", {"value": 0, "suffix": " ₸", "label": "Деньги", "icon": "coin"}),
    (re.compile(r"\b(\d+)\s*(%|процент)\b", re.I),
     "metric-callout", {"value": "+0%", "label": "Рост", "up": True, "icon": "chart"}),
    (re.compile(r"\b(рост|паден|больше|меньше|выше|ниже)\b", re.I),
     "metric-callout", {"value": "↑", "label": "Динамика", "up": True, "icon": "chart"}),
    (re.compile(r"\b(шаг|этап|сначала|потом|далее|перв|втор|трет)\b", re.I),
     "timeline-steps", {"steps": ["Шаг 1", "Шаг 2", "Шаг 3"]}),
    (re.compile(r"\b(ии|нейросет|chatgpt|claude|код|приложен|сайт|программ)\b", re.I),
     "fake-terminal", {"title": "AI build", "lines": ["> generating...", "✓ done"]}),
    (re.compile(r"\b(список|три|четыре|пять|пункт)\b", re.I),
     "checklist-reveal", {"items": ["Пункт 1", "Пункт 2", "Пункт 3"], "icons": ["check", "check", "check"]}),
    (re.compile(r"\b(думаешь|считаешь|знаешь|понимаешь|вопрос)\b", re.I),
     "notification-toast", {"title": "Вопрос", "text": "?", "icon": "target"}),
    (re.compile(r"\b(ошибк|проблем|не работ|сложн)\b", re.I),
     "notification-toast", {"title": "Важно", "text": "!", "icon": "bolt"}),
    (re.compile(r"\b(успех|результат|готово|получил)\b", re.I),
     "loading-to-done", {"label": "Обработка", "doneLabel": "Готово"}),
]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip())


def _phrase(words: list[dict], i0: int, i1: int, max_words: int = 6) -> str:
    chunk = words[i0 : min(i1 + 1, i0 + max_words)]
    return _norm(" ".join(w.get("pw") or w.get("w", "") for w in chunk))


def _pick_template(text: str) -> tuple[str, dict]:
    for pat, template, data in RULES:
        if pat.search(text):
            d = dict(data)
            if template == "notification-toast":
                d["text"] = text[:48] or d.get("text", "!")
            elif template == "kinetic-type":
                pass
            elif template in ("quote-card", "big-statement"):
                d["text"] = text[:80]
            return template, d
    words = [w for w in re.split(r"[^\wа-яёА-ЯЁ]+", text, flags=re.I) if len(w) > 2][:4]
    if not words:
        words = text.split()[:3] or ["мысль"]
    return "kinetic-type", {"words": words[:3], "accentIndex": 0, "icon": "bolt"}


def _covered(ranges: list[tuple[int, int]], i0: int, i1: int) -> bool:
    for a, b in ranges:
        if not (i1 < a or i0 > b):
            return True
    return False


def _merge_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not ranges:
        return []
    ranges = sorted(ranges)
    out = [ranges[0]]
    for a, b in ranges[1:]:
        la, lb = out[-1]
        if a <= lb + 2:
            out[-1] = (la, max(lb, b))
        else:
            out.append((a, b))
    return out


def enrich(work: Path, gap_sec: float = 4.5, cover_ratio: float = 0.0) -> dict:
    words_path = work / "words.json"
    if not words_path.exists():
        raise SystemExit(f"missing {words_path}")
    words: list[dict] = json.loads(words_path.read_text(encoding="utf-8"))
    if not words:
        return {"inserts": []}

    ins_path = work / "inserts.json"
    base_doc = {"inserts": []}
    if ins_path.exists():
        base_doc = json.loads(ins_path.read_text(encoding="utf-8"))
    existing = list(base_doc.get("inserts") or [])

    ranges: list[tuple[int, int]] = []
    merged: list[dict] = []
    for it in existing:
        try:
            a = int(it["anchorWord"])
            b = int(it["endWord"])
        except (KeyError, TypeError, ValueError):
            continue
        if b <= a:
            continue
        ranges.append((a, b))
        data = dict(it.get("data") or {})
        if it.get("template") and "cover" not in data:
            data.setdefault("cover", False)
        merged.append({**it, "data": data})

    duration = float(words[-1].get("end") or 0)
    t = float(words[0].get("start") or 0)
    color_i = 0
    auto_added = 0
    cover_ratio = max(0.0, min(0.85, float(cover_ratio or 0)))

    while t < duration - 0.5:
        window_end = min(duration, t + gap_sec)
        idxs = [w["i"] for w in words if t <= w["start"] < window_end]
        if not idxs:
            t = window_end
            continue
        i0, i1 = idxs[0], idxs[-1]
        if _covered(ranges, i0, i1):
            t = window_end
            continue

        text = _phrase(words, i0, i1)
        template, data = _pick_template(text)
        accent = ACCENTS[color_i % len(ACCENTS)]
        color_i += 1
        # Для кейс-стиля чередуем cover-сцены (мысль на весь экран) и оверлеи.
        use_cover = cover_ratio > 0 and (auto_added % max(1, round(1 / cover_ratio))) == 0
        data = {**data, "accent": accent, "cover": bool(use_cover)}

        merged.append({
            "anchorWord": i0,
            "endWord": max(i0 + 1, min(i1, i0 + 8)),
            "template": template,
            "data": data,
            "layout": "third" if not use_cover else "full",
            "note": f"auto:{template}{'/cover' if use_cover else ''}",
        })
        ranges.append((i0, i1))
        auto_added += 1
        t = window_end

    merged.sort(key=lambda x: int(x["anchorWord"]))
    out = {"inserts": merged}
    ins_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK inserts={len(merged)} auto_added={auto_added} gap={gap_sec}s cover_ratio={cover_ratio}")
    return out


if __name__ == "__main__":
    work_dir = Path(sys.argv[1])
    gap = float(sys.argv[2]) if len(sys.argv) > 2 else 4.5
    cover = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    enrich(work_dir, gap, cover)
