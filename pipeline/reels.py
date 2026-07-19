# -*- coding: utf-8 -*-
"""Build ReelsExplainer (faceless Reels-видео) props from work/<id>/reels.json.

Лица нет: озвучка (vo) + непрерывная лента моушн-сцен из библиотеки + караоке-титры.
Сцены размечает Claude ПО СМЫСЛУ фразы (как splits.json для 50/50).

reels.json:
{
  "id": "Reels-<id>",
  "audio": "vo_<id>",               // базовое имя mp3 в public/reels
  "music": "beat_<id>.wav" | null,  // подложка (в public), тихо
  "theme": "neon-violet",           // опционально — иначе выбирается по id
  "accents": [8, 11],               // акцентные слова в титрах
  "fixes": {"8": "50 000"},         // правки текста титра ("" — убрать слово)
  "captionsDefault": true,          // показывать караоке-строку (по сцене можно data.caption=false)
  "scenes": [
    {"anchorWord": 0, "endWord": 9, "template": "price-tag",
     "data": {"price": "50 000 ₸", "label": "ТЕСТОВАЯ НЕДЕЛЯ", "accent": "#34D399"}},
    ...
  ]
}

Usage: python reels.py <work_dir> <remotion_props_dir> <audio_duration_sec>
"""
import json
import sys
from pathlib import Path

FPS = 30

# Должны совпадать с remotion/src/themes.ts — REELS_THEME_IDS.
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


def pick_theme(seed: str) -> str:
    h = 0
    for ch in seed:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return THEMES[h % len(THEMES)]


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
    for s in cfg.get("scenes", []):
        w0, w1 = wbi.get(s["anchorWord"]), wbi.get(s["endWord"])
        if not w0 or not w1:
            continue
        data = dict(s.get("data") or {})
        if "caption" not in data and not cap_default:
            data["caption"] = False
        scenes.append({
            "from": round(w0["start"] * FPS),
            "to": round(min(w1["end"], audio_dur) * FPS),
            "template": s["template"],
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
    print(f"OK {cfg['id']}: {total}f ({total/FPS:.1f}s) words={len(kw)} scenes={len(scenes)} "
          f"theme={theme} music={'yes' if cfg.get('music') else 'no'}")


if __name__ == "__main__":
    work = Path(sys.argv[1])
    props_dir = Path(sys.argv[2])
    audio_dur = float(sys.argv[3])
    build(work, props_dir, audio_dur)
