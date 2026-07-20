# -*- coding: utf-8 -*-
"""Build ReelsExplainer (faceless Reels-видео) props from work/<id>/reels.json.

Лица нет: озвучка (vo) + непрерывная лента моушн-сцен из библиотеки + караоке-титры.
Сцены размечает Claude ПО СМЫСЛУ фразы (как splits.json для 50/50).
Опционально: сцены type=video + file=… — cutaway из папки/Pexels/Kie.

reels.json:
{
  "id": "Reels-<id>",
  "audio": "vo_<id>",
  "music": "beat_<id>.wav" | null,
  "theme": "neon-violet",
  "accents": [8, 11],
  "fixes": {"8": "50 000"},
  "captionsDefault": true,
  "scenes": [
    {"anchorWord": 0, "endWord": 9, "template": "price-tag",
     "data": {"price": "50 000 ₸", "label": "ТЕСТОВАЯ НЕДЕЛЯ", "accent": "#34D399"}},
    {"anchorWord": 10, "endWord": 18, "type": "video", "file": "reels/inserts/<id>/01.mp4"},
    ...
  ]
}

Usage: python reels.py <work_dir> <remotion_props_dir> <audio_duration_sec>
"""
import json
import re
import sys
from pathlib import Path

FPS = 30

THEMES = [
    "midnight-orange",
    "neon-violet",
    "ocean-cyan",
    "ember-red",
    "mint-fresh",
    "gold-noir",
    "paper-ink",
    "aurora-green",
]

ECHO_TEMPLATES = frozenset({"big-statement", "kinetic-type", "quote-card"})


def pick_theme(seed: str) -> str:
    h = 0
    for ch in seed:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return THEMES[h % len(THEMES)]


def _words(s: str) -> list[str]:
    return [w for w in re.split(r"\s+", (s or "").strip()) if w]


def normalize_scene_data(template: str, data: dict) -> dict | None:
    """Map AI field aliases → Remotion props. Drop empty / speech-echo text dumps."""
    d = dict(data or {})
    text = str(d.get("text") or d.get("caption") or d.get("quote") or d.get("label") or "").strip()

    if template == "kinetic-type":
        words = d.get("words")
        if not isinstance(words, list) or not words:
            lines = d.get("lines")
            if isinstance(lines, list) and lines:
                words = _words(" ".join(str(x) for x in lines))
            elif isinstance(lines, str) and lines.strip():
                words = _words(lines)
            else:
                words = _words(text)
            words = words[:5]
            if not words:
                return None
            d["words"] = words
        d.pop("lines", None)
        d.pop("text", None)
        d.pop("caption", None)

    elif template in ("big-statement", "quote-card"):
        lines = d.get("lines")
        if not isinstance(lines, list) or not lines:
            if text:
                ws = _words(text)
                d["lines"] = [" ".join(ws[:3])] if ws else []
            else:
                return None
        d.pop("text", None)
        d.pop("caption", None)
        d.pop("quote", None)
        joined = " ".join(str(x) for x in d.get("lines") or [])
        if len(_words(joined)) > 4:
            return None

    elif template == "notification-toast":
        if not d.get("text") and not d.get("title"):
            if text:
                d["text"] = " ".join(_words(text)[:5])
                d.setdefault("title", "Важно")
            else:
                return None

    elif template == "countdown":
        if d.get("from") is None and d.get("value") is not None:
            try:
                d["from"] = int(float(d["value"]))
            except (TypeError, ValueError):
                d["from"] = 3
        if text and not d.get("label"):
            d["label"] = " ".join(_words(text)[:4])

    return d


def build(work: Path, props_dir: Path, audio_dur: float):
    words = json.loads((work / "words.json").read_text(encoding="utf-8"))
    cfg = json.loads((work / "reels.json").read_text(encoding="utf-8"))

    accents = set(cfg.get("accents", []))
    fixes = {int(k): v for k, v in cfg.get("fixes", {}).items()}
    cap_default = cfg.get("captionsDefault", True)
    wbi = {w["i"]: w for w in words}
    total = round(audio_dur * FPS)
    theme = cfg.get("theme") or pick_theme(str(cfg.get("id") or work.name))

    kw = []
    for w in words:
        if w["start"] > audio_dur:
            continue
        txt = fixes.get(w["i"], w["pw"].strip().strip(",."))
        if txt == "":
            continue
        kw.append({
            "text": txt,
            "from": round(w["start"] * FPS),
            "to": round(min(w["end"], audio_dur) * FPS),
            "accent": w["i"] in accents,
        })

    scenes = []
    dropped = 0
    for s in cfg.get("scenes", []):
        w0, w1 = wbi.get(s["anchorWord"]), wbi.get(s["endWord"])
        if not w0 or not w1:
            continue
        if s.get("file") and (s.get("type") == "video" or not s.get("template")):
            scenes.append({
                "from": round(w0["start"] * FPS),
                "to": round(min(w1["end"], audio_dur) * FPS),
                "template": "",
                "type": "video",
                "file": s["file"],
                "data": {"caption": True, **(s.get("data") or {})},
            })
            continue

        template = str(s.get("template") or "").strip()
        if not template:
            continue
        data = normalize_scene_data(template, s.get("data") or {})
        if data is None:
            dropped += 1
            continue
        if "caption" not in data and not cap_default:
            data["caption"] = False
        if template in ECHO_TEMPLATES:
            data["caption"] = False
        scenes.append({
            "from": round(w0["start"] * FPS),
            "to": round(min(w1["end"], audio_dur) * FPS),
            "template": template,
            "data": data,
        })
    scenes.sort(key=lambda e: e["from"])
    for i in range(len(scenes)):
        scenes[i]["to"] = scenes[i + 1]["from"] if i + 1 < len(scenes) else total
    if scenes:
        scenes[0]["from"] = 0

    props = {
        "audioTrack": f"reels/{cfg['audio']}.mp3",
        "words": kw,
        "scenes": scenes,
        "totalDurationInFrames": total,
        "fps": FPS,
        "music": f"reels/{cfg['music']}" if cfg.get("music") else None,
        "musicVolume": cfg.get("musicVolume", 0.1),
        "captions": True,
        "theme": theme,
        "themeSeed": str(cfg.get("id") or work.name),
    }
    out = props_dir / f"{cfg['id']}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(props, ensure_ascii=False, indent=1), encoding="utf-8")
    if not cfg.get("theme"):
        cfg["theme"] = theme
        (work / "reels.json").write_text(
            json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8",
        )
    print(
        f"OK {cfg['id']}: {total}f ({total/FPS:.1f}s) words={len(kw)} scenes={len(scenes)} "
        f"dropped={dropped} theme={theme} music={'yes' if cfg.get('music') else 'no'}"
    )


if __name__ == "__main__":
    work = Path(sys.argv[1])
    props_dir = Path(sys.argv[2])
    audio_dur = float(sys.argv[3])
    build(work, props_dir, audio_dur)
