# -*- coding: utf-8 -*-
"""Build Split5050 (Монтаж 50/50) props from work/<id>/splits.json.

Спикер играет непрерывно (своя дорожка, без declick — джампкатов нет), а в
размеченные «сплит-моменты» открывается вторая половина: запись экрана
(media `screen`) ИЛИ Remotion-сцена из библиотеки (template + data).

splits.json:
{
  "id": "Split-<id>",
  "speaker": "bottom",              // где спикер: bottom (default) | top
  "startWord": 5, "endWord": 77,    // границы речи (обрезка тишины/лишнего)
  "accents": [7, 30, ...],          // акцентные слова в титрах
  "fixes": {"48": "5 000 000"},     // правки текста титров ("" — убрать слово)
  "splits": [
    {"anchorWord": 37, "endWord": 43, "template": "fake-terminal",
     "data": {"lines": ["$ claude build app", "✓ готово"], "accent": "#22D3EE"}},
    {"anchorWord": 44, "endWord": 49, "screenFrom": 120}   // из записи экрана
  ]
}

Usage: python split.py <work_dir> <remotion_props_dir> <speaker_media> [screen_media]
"""
import json
import sys
from pathlib import Path

FPS = 30


def build(work: Path, props_dir: Path, media: str, screen: str | None):
    words = json.loads((work / "words.json").read_text(encoding="utf-8"))
    cfg = json.loads((work / "splits.json").read_text(encoding="utf-8"))

    start_word = cfg.get("startWord", 0)
    end_word = cfg.get("endWord", words[-1]["i"])
    speaker = cfg.get("speaker", "bottom")
    accents = set(cfg.get("accents", []))
    fixes = {int(k): v for k, v in cfg.get("fixes", {}).items()}
    wbi = {w["i"]: w for w in words}

    start_sec = wbi[start_word]["start"]
    end_sec = wbi[end_word]["end"]
    speaker_start = round(start_sec * FPS)
    total = round((end_sec - start_sec) * FPS)

    # karaoke words in output frames
    kw = []
    for w in words:
        if w["start"] < start_sec - 0.01 or w["start"] > end_sec:
            continue
        txt = fixes.get(w["i"], w["pw"].strip().strip(",."))
        if txt == "":
            continue
        kw.append({"text": txt, "from": round((w["start"] - start_sec) * FPS), "accent": w["i"] in accents})

    # split moments
    splits = []
    for s in cfg.get("splits", []):
        w0, w1 = wbi.get(s["anchorWord"]), wbi.get(s["endWord"])
        if not w0 or not w1:
            continue
        ev = {
            "from": round((w0["start"] - start_sec) * FPS),
            "to": round((min(w1["end"], end_sec) - start_sec) * FPS),
        }
        if s.get("template"):
            ev["template"] = s["template"]
        if s.get("data"):
            ev["data"] = s["data"]
        if s.get("screenFrom") is not None:
            ev["screenFrom"] = s["screenFrom"]
        ev["to"] = max(ev["to"], ev["from"] + 30)  # keep a split on screen ≥1s
        splits.append(ev)
    splits.sort(key=lambda e: e["from"])

    props = {
        "src": f"{media}.mp4",
        "previewSrc": None,
        "fps": FPS,
        "speakerStartFrame": speaker_start,
        "words": kw,
        "audioTrack": None,           # continuous speaker plays its own audio
        "screen": f"{screen}.mp4" if screen else None,
        "speaker": speaker,
        "splits": splits,
        "totalDurationInFrames": total,
        "music": cfg.get("music"),
    }
    out = props_dir / f"{cfg['id']}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(props, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK {cfg['id']}: {total}f ({total/FPS:.1f}s) words={len(kw)} splits={len(splits)} "
          f"screen={'yes' if screen else 'motion/placeholder'}")


if __name__ == "__main__":
    work = Path(sys.argv[1])
    props_dir = Path(sys.argv[2])
    media = sys.argv[3]
    screen = sys.argv[4] if len(sys.argv) > 4 else None
    build(work, props_dir, media, screen)
